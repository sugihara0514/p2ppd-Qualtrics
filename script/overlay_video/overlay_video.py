#!/usr/bin/env python3
import argparse
import csv
import json
import math
import os
import shlex
import subprocess
from dataclasses import dataclass
from typing import Dict, List, Optional

PHASE_LABELS = {
    "recording_started": "Recording",
    "baseline_done": "Baseline Done",
    "choice_started": "Choice",
    "choice_submitted": "Choice",
    "result": "Result",
    "emotion_started": "Emotion",
    "emotion_submitted": "Emotion",
    "next_round_started": "Choice",
    "game_finished": "Finished",
}

CHOICE_LABELS = {
    "C": "Green",
    "D": "Blue",
    "": "-",
    None: "-",
}

@dataclass
class Segment:
    start_s: float
    end_s: float
    phase: str
    round_num: int
    left_choice: str
    right_choice: str
    left_total: str
    right_total: str


def sec_to_ass_time(sec: float) -> str:
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


def ass_escape(text: str) -> str:
    return str(text).replace('\\', r'\\').replace('{', r'\{').replace('}', r'\}')


def parse_meta_json(path: str) -> List[Dict]:
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    rec = data.get('recording') or {}
    started = rec.get('startedAtMs')
    if not started:
        raise ValueError('JSON metadata must include recording.startedAtMs')
    events = data.get('phaseEvents') or []
    out = []
    for ev in events:
        row = dict(ev)
        row['recordingStartedAtMs'] = started
        out.append(row)
    return out


def parse_csv(path: str) -> List[Dict]:
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def normalize_events(rows: List[Dict]) -> List[Dict]:
    if not rows:
        raise ValueError('No rows found in metadata input')

    def get_first(*keys):
        for r in rows:
            for k in keys:
                v = r.get(k)
                if v not in (None, ''):
                    return v
        return None

    recording_started_ms = get_first('recordingStartedAtMs', 'recording_started_at_ms', 'recording_started_ms')
    if recording_started_ms is None:
        recording_event = next((r for r in rows if (r.get('phase') or '').strip() == 'recording_started'), None)
        if recording_event:
            recording_started_ms = recording_event.get('atMs') or recording_event.get('at_ms')

    if recording_started_ms is None:
        raise ValueError('metadata must include recordingStartedAtMs (or a recording_started event)')

    recording_started_ms = int(float(recording_started_ms))

    norm = []
    for r in rows:
        at_ms = r.get('atMs', r.get('at_ms'))
        if at_ms in (None, ''):
            continue
        phase = (r.get('phase') or '').strip()
        round_num = r.get('round', r.get('round_num', 0))
        left_choice = r.get('leftChoice', r.get('left_choice', ''))
        right_choice = r.get('rightChoice', r.get('right_choice', ''))
        left_total = r.get('leftTotal', r.get('left_total', ''))
        right_total = r.get('rightTotal', r.get('right_total', ''))
        norm.append({
            'atMs': int(float(at_ms)),
            'phase': phase,
            'round': int(float(round_num or 0)),
            'leftChoice': left_choice,
            'rightChoice': right_choice,
            'leftTotal': str(left_total) if left_total not in (None, '') else '',
            'rightTotal': str(right_total) if right_total not in (None, '') else '',
            'recordingStartedAtMs': recording_started_ms,
        })
    norm.sort(key=lambda x: x['atMs'])
    return norm


def fill_stateful_events(events: List[Dict]) -> List[Dict]:
    current = {
        'leftChoice': '',
        'rightChoice': '',
        'leftTotal': '0',
        'rightTotal': '0',
        'phase': 'recording_started',
        'round': 0,
    }
    out = []
    for ev in events:
        row = dict(current)
        row.update(ev)
        # carry forward known scoreboard / choices unless explicitly updated
        for key in ('leftChoice', 'rightChoice', 'leftTotal', 'rightTotal'):
            if ev.get(key) not in (None, ''):
                current[key] = str(ev[key])
            row[key] = current[key]
        if ev.get('phase'):
            current['phase'] = ev['phase']
            row['phase'] = ev['phase']
        if 'round' in ev and ev['round'] is not None:
            current['round'] = int(ev['round'])
            row['round'] = current['round']
        out.append(row)
    return out


def build_segments(events: List[Dict], duration_s: float) -> List[Segment]:
    events = fill_stateful_events(events)
    base_ms = events[0]['recordingStartedAtMs']
    segments: List[Segment] = []
    for i, ev in enumerate(events):
        start_s = max(0.0, (ev['atMs'] - base_ms) / 1000.0)
        if i + 1 < len(events):
            end_s = max(start_s, (events[i + 1]['atMs'] - base_ms) / 1000.0)
        else:
            end_s = max(start_s, duration_s)
        segments.append(Segment(
            start_s=start_s,
            end_s=end_s,
            phase=ev.get('phase') or 'recording_started',
            round_num=int(ev.get('round') or 0),
            left_choice=CHOICE_LABELS.get(ev.get('leftChoice'), str(ev.get('leftChoice') or '-')),
            right_choice=CHOICE_LABELS.get(ev.get('rightChoice'), str(ev.get('rightChoice') or '-')),
            left_total=str(ev.get('leftTotal') or '0'),
            right_total=str(ev.get('rightTotal') or '0'),
        ))
    return segments


def write_ass(path: str, segments: List[Segment]) -> None:
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Phase,Arial,26,&H00FFFFFF,&H000000FF,&H00101010,&H64000000,1,0,0,0,100,100,0,0,1,2,0,9,30,30,24,1
Style: Score,Arial,24,&H00FFFFFF,&H000000FF,&H00101010,&H64000000,1,0,0,0,100,100,0,0,1,2,0,1,28,28,20,1
Style: Choice,Arial,24,&H00FFFFFF,&H000000FF,&H00101010,&H64000000,1,0,0,0,100,100,0,0,1,2,0,2,28,28,52,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    for seg in segments:
        start = sec_to_ass_time(seg.start_s)
        end = sec_to_ass_time(seg.end_s)
        phase_text = f"Phase: {PHASE_LABELS.get(seg.phase, seg.phase)}    Round: {seg.round_num}"
        score_text = f"Left Score: {seg.left_total}    Right Score: {seg.right_total}"
        choice_text = f"Left: {seg.left_choice}    Right: {seg.right_choice}"
        lines.append(f"Dialogue: 0,{start},{end},Phase,,0,0,0,,{ass_escape(phase_text)}\n")
        lines.append(f"Dialogue: 0,{start},{end},Score,,0,0,0,,{ass_escape(score_text)}\n")
        lines.append(f"Dialogue: 0,{start},{end},Choice,,0,0,0,,{ass_escape(choice_text)}\n")
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines)


def ffprobe_duration(path: str) -> float:
    cmd = [
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', path
    ]
    out = subprocess.check_output(cmd, text=True).strip()
    return float(out)


def run_ffmpeg(input_mp4: str, ass_path: str, output_mp4: str) -> None:
    cmd = [
        'ffmpeg', '-y', '-i', input_mp4,
        '-vf', f"ass={ass_path}",
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
        '-c:a', 'copy',
        output_mp4,
    ]
    print('Running:', ' '.join(shlex.quote(x) for x in cmd))
    subprocess.run(cmd, check=True)


def main():
    p = argparse.ArgumentParser(description='Overlay phase / choice / score onto recorded MP4 using metadata CSV or JSON.')
    p.add_argument('--input', required=True, help='input mp4 path')
    p.add_argument('--meta', required=True, help='metadata csv or json path')
    p.add_argument('--output', required=True, help='output mp4 path')
    p.add_argument('--ass-out', default=None, help='optional output ASS subtitle path')
    p.add_argument('--dry-run', action='store_true', help='only generate ASS, do not render video')
    args = p.parse_args()

    if not os.path.exists(args.input):
        raise SystemExit(f'input not found: {args.input}')
    if not os.path.exists(args.meta):
        raise SystemExit(f'meta not found: {args.meta}')

    if args.meta.lower().endswith('.json'):
        rows = parse_meta_json(args.meta)
    else:
        rows = parse_csv(args.meta)

    events = normalize_events(rows)
    duration_s = ffprobe_duration(args.input)
    segments = build_segments(events, duration_s)

    ass_path = args.ass_out or os.path.splitext(args.output)[0] + '.ass'
    write_ass(ass_path, segments)
    print(f'Wrote ASS overlay: {ass_path}')

    if not args.dry_run:
        run_ffmpeg(args.input, ass_path, args.output)
        print(f'Wrote video: {args.output}')


if __name__ == '__main__':
    main()
