#!/usr/bin/env python3
import argparse
import csv
import os
import shlex
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional


DEFAULT_ROUNDS = (1, 2, 3)


@dataclass
class ChoiceSegment:
    round_num: int
    start_s: float
    end_s: float
    you_choice: str = ""
    opp_choice: str = ""

    @property
    def duration_s(self) -> float:
        return max(0.0, self.end_s - self.start_s)


def parse_ms(value: object) -> Optional[int]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def read_qualtrics_rows(path: str) -> List[Dict[str, str]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def choose_row(rows: List[Dict[str, str]], response_id: Optional[str]) -> Dict[str, str]:
    if not rows:
        raise ValueError("CSV has no data rows")

    if response_id:
        for row in rows:
            if str(row.get("ResponseId", "")).strip() == response_id:
                return row
        raise ValueError(f"ResponseId not found: {response_id}")

    # Qualtrics exports can include non-response metadata rows after the header.
    # Pick the first row that has the baseline timestamp.
    for row in rows:
        if get_embedded_ms(row, "pd_r0_emotionStartAt") is not None:
            return row

    raise ValueError("No row has a numeric pd_r0_emotionStartAt or __js_pd_r0_emotionStartAt")


def get_embedded_value(row: Dict[str, str], key: str) -> Optional[str]:
    for candidate in (key, f"__js_{key}"):
        value = row.get(candidate)
        if value not in (None, ""):
            return value
    return None


def get_embedded_ms(row: Dict[str, str], key: str) -> Optional[int]:
    return parse_ms(get_embedded_value(row, key))


def normalize_choice(value: Optional[str]) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text in ("", "null", "None") else text


def choice_label(value: str) -> str:
    labels = {
        "C": "Green",
        "D": "Blue",
        "緑": "Green",
        "青": "Blue",
    }
    return labels.get(value, value or "-")


def build_segments(
    row: Dict[str, str],
    rounds: Iterable[int],
    offset_s: float,
    pad_before_s: float,
    pad_after_s: float,
) -> List[ChoiceSegment]:
    base_ms = get_embedded_ms(row, "pd_r0_emotionStartAt")
    if base_ms is None:
        raise ValueError("pd_r0_emotionStartAt or __js_pd_r0_emotionStartAt is required as the timing baseline")

    segments: List[ChoiceSegment] = []
    for round_num in rounds:
        choice_ms = get_embedded_ms(row, f"pd_r{round_num}_choiceStartAt")
        emotion_ms = get_embedded_ms(row, f"pd_r{round_num}_emotionStartAt")
        if choice_ms is None or emotion_ms is None:
            print(f"skip round {round_num}: missing choiceStartAt or emotionStartAt")
            continue

        start_s = ((choice_ms - base_ms) / 1000.0) + offset_s - pad_before_s
        end_s = ((emotion_ms - base_ms) / 1000.0) + offset_s + pad_after_s
        start_s = max(0.0, start_s)

        if end_s <= start_s:
            print(f"skip round {round_num}: non-positive interval ({start_s:.3f}..{end_s:.3f})")
            continue

        you_choice = normalize_choice(get_embedded_value(row, f"pd_r{round_num}_youChoice"))
        opp_choice = normalize_choice(get_embedded_value(row, f"pd_r{round_num}_oppChoice"))
        segments.append(
            ChoiceSegment(
                round_num=round_num,
                start_s=start_s,
                end_s=end_s,
                you_choice=you_choice,
                opp_choice=opp_choice,
            )
        )

    if not segments:
        raise ValueError("No valid choice segments were found")
    return segments


def run(cmd: List[str]) -> None:
    print("Running:", " ".join(shlex.quote(x) for x in cmd))
    subprocess.run(cmd, check=True)


def ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)


def ffprobe_duration(path: str) -> Optional[float]:
    try:
        out = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            text=True,
        ).strip()
        return float(out)
    except Exception:
        return None


def clamp_segments(segments: List[ChoiceSegment], duration_s: Optional[float]) -> List[ChoiceSegment]:
    if duration_s is None:
        return segments

    clamped: List[ChoiceSegment] = []
    for seg in segments:
        start_s = min(max(0.0, seg.start_s), duration_s)
        end_s = min(max(start_s, seg.end_s), duration_s)
        if end_s <= start_s:
            print(
                f"skip round {seg.round_num}: outside video duration "
                f"(segment {seg.start_s:.3f}..{seg.end_s:.3f}s, video {duration_s:.3f}s)"
            )
            continue
        clamped.append(ChoiceSegment(seg.round_num, start_s, end_s, seg.you_choice, seg.opp_choice))
    if not clamped:
        raise ValueError("All choice segments are outside the video duration")
    return clamped


def write_timeline(path: str, segments: List[ChoiceSegment]) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["round", "start_s", "end_s", "duration_s", "you_choice", "opp_choice"],
        )
        writer.writeheader()
        for seg in segments:
            writer.writerow(
                {
                    "round": seg.round_num,
                    "start_s": f"{seg.start_s:.3f}",
                    "end_s": f"{seg.end_s:.3f}",
                    "duration_s": f"{seg.duration_s:.3f}",
                    "you_choice": seg.you_choice,
                    "opp_choice": seg.opp_choice,
                }
            )


def sec_to_ass_time(sec: float) -> str:
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


def ass_escape(text: str) -> str:
    return str(text).replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")


def ass_join_lines(lines: List[str]) -> str:
    return r"\N".join(ass_escape(line) for line in lines)


def escape_filter_path(path: str) -> str:
    # ffmpeg filter arguments treat ':' and '\' specially on Windows.
    return path.replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


def build_overlay_lines(seg: ChoiceSegment, segments: List[ChoiceSegment], round_label: bool, choice_history: bool) -> List[str]:
    lines: List[str] = []
    if round_label:
        lines.append(f"Round {seg.round_num}")
    if choice_history:
        if lines:
            lines.append("")
        lines.append("Choice history")
        for item in segments:
            if item.round_num > seg.round_num:
                continue
            lines.append(
                f"R{item.round_num}: You {choice_label(item.you_choice)} / Partner {choice_label(item.opp_choice)}"
            )
    return lines


def write_overlay_ass(
    path: str,
    seg: ChoiceSegment,
    segments: List[ChoiceSegment],
    round_label: bool,
    choice_history: bool,
) -> None:
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Overlay,Arial,30,&H00FFFFFF,&H000000FF,&H00101010,&H80000000,1,0,0,0,100,100,0,0,3,2,0,7,24,24,24,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = build_overlay_lines(seg, segments, round_label, choice_history)
    line = (
        f"Dialogue: 0,{sec_to_ass_time(0)},{sec_to_ass_time(seg.duration_s)},"
        f"Overlay,,0,0,0,,{ass_join_lines(lines)}\n"
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(header)
        f.write(line)


def describe_selected_row(row: Dict[str, str]) -> None:
    response_id = row.get("ResponseId") or "(unknown)"
    room = get_embedded_value(row, "pd_room") or "(unknown)"
    side = get_embedded_value(row, "pd_video_side") or "(unknown)"
    print(f"Selected row: ResponseId={response_id}, room={room}, side={side}")


def cut_segment(
    input_video: str,
    output_video: str,
    seg: ChoiceSegment,
    segments: List[ChoiceSegment],
    reencode: bool,
    round_label: bool,
    choice_history: bool,
) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{seg.start_s:.3f}",
        "-to",
        f"{seg.end_s:.3f}",
        "-i",
        input_video,
    ]
    if round_label or choice_history:
        ass_path = os.path.splitext(output_video)[0] + "_overlay.ass"
        write_overlay_ass(ass_path, seg, segments, round_label, choice_history)
        cmd += [
            "-vf",
            f"ass='{escape_filter_path(ass_path)}'",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-c:a",
            "aac",
        ]
    elif reencode:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac"]
    else:
        cmd += ["-c", "copy"]
    cmd.append(output_video)
    run(cmd)


def concat_segments(segment_paths: List[str], output_video: str, reencode: bool) -> None:
    concat_file = os.path.join(os.path.dirname(segment_paths[0]), "concat.txt")
    with open(concat_file, "w", encoding="utf-8") as f:
        for path in segment_paths:
            safe_path = path.replace("\\", "/").replace("'", "'\\''")
            f.write(f"file '{safe_path}'\n")

    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file]
    if reencode:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac"]
    else:
        cmd += ["-c", "copy"]
    cmd.append(output_video)
    run(cmd)


def parse_rounds(text: str) -> List[int]:
    rounds = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        rounds.append(int(part))
    return rounds


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cut and concatenate only choice phases from a recorded PD video using Qualtrics Embedded Data."
    )
    parser.add_argument("--video", required=True, help="input video path")
    parser.add_argument("--csv", required=True, help="Qualtrics CSV export path")
    parser.add_argument("--output", required=True, help="output video path")
    parser.add_argument("--output-dir", default=None, help="directory where output video and timeline CSV are saved")
    parser.add_argument("--response-id", default=None, help="ResponseId to process; defaults to first row with timestamps")
    parser.add_argument("--rounds", default="1,2,3", help="comma-separated rounds to keep")
    parser.add_argument(
        "--offset-sec",
        type=float,
        default=0.0,
        help="manual timing correction added to all cuts. Use when video does not start exactly at pd_r0_emotionStartAt",
    )
    parser.add_argument("--pad-before-sec", type=float, default=0.0, help="seconds to include before each choice phase")
    parser.add_argument("--pad-after-sec", type=float, default=0.0, help="seconds to include after each choice phase")
    parser.add_argument("--timeline-out", default=None, help="optional CSV path for computed cut points")
    parser.add_argument("--keep-temp", default=None, help="directory to keep individual round clips")
    parser.add_argument("--round-label", action="store_true", help="burn a visible Round N label into each clipped segment")
    parser.add_argument(
        "--choice-history",
        action="store_true",
        help="burn cumulative choice history into each clipped segment; requires pd_rN_youChoice/pd_rN_oppChoice columns",
    )
    parser.add_argument(
        "--reencode",
        action="store_true",
        help="re-encode clips for more reliable concatenation; slower but safer than stream copy",
    )
    parser.add_argument("--dry-run", action="store_true", help="write/print timeline only; do not run ffmpeg")
    args = parser.parse_args()

    if not os.path.exists(args.video):
        raise SystemExit(f"video not found: {args.video}")
    if not os.path.exists(args.csv):
        raise SystemExit(f"csv not found: {args.csv}")
    if shutil.which("ffmpeg") is None and not args.dry_run:
        raise SystemExit("ffmpeg not found in PATH")

    output_path = args.output
    if args.output_dir:
        os.makedirs(args.output_dir, exist_ok=True)
        output_path = os.path.join(args.output_dir, os.path.basename(output_path))
    ensure_parent_dir(output_path)

    rows = read_qualtrics_rows(args.csv)
    row = choose_row(rows, args.response_id)
    describe_selected_row(row)
    segments = build_segments(
        row=row,
        rounds=parse_rounds(args.rounds),
        offset_s=args.offset_sec,
        pad_before_s=args.pad_before_sec,
        pad_after_s=args.pad_after_sec,
    )
    print("Raw segments from timestamps:")
    for seg in segments:
        print(
            f"round {seg.round_num}: {seg.start_s:.3f}s -> {seg.end_s:.3f}s "
            f"({seg.duration_s:.3f}s), you={choice_label(seg.you_choice)}, opp={choice_label(seg.opp_choice)}"
        )

    duration_s = ffprobe_duration(args.video) if shutil.which("ffprobe") else None
    if duration_s is not None:
        print(f"Video duration: {duration_s:.3f}s")
    segments = clamp_segments(segments, duration_s)

    timeline_out = args.timeline_out or os.path.splitext(output_path)[0] + "_timeline.csv"
    if args.output_dir and args.timeline_out:
        timeline_out = os.path.join(args.output_dir, os.path.basename(args.timeline_out))
    ensure_parent_dir(timeline_out)
    write_timeline(timeline_out, segments)
    print(f"Wrote timeline: {timeline_out}")
    for seg in segments:
        print(
            f"round {seg.round_num}: {seg.start_s:.3f}s -> {seg.end_s:.3f}s "
            f"({seg.duration_s:.3f}s), you={choice_label(seg.you_choice)}, opp={choice_label(seg.opp_choice)}"
        )

    if args.dry_run:
        return

    temp_owner = None
    if args.keep_temp:
        temp_dir = args.keep_temp
        os.makedirs(temp_dir, exist_ok=True)
    else:
        temp_owner = tempfile.TemporaryDirectory(prefix="choice_phases_")
        temp_dir = temp_owner.name

    try:
        ext = os.path.splitext(output_path)[1] or ".mp4"
        clip_paths = []
        for seg in segments:
            clip_path = os.path.join(temp_dir, f"round_{seg.round_num}_choice{ext}")
            cut_segment(
                args.video,
                clip_path,
                seg,
                segments,
                args.reencode,
                args.round_label,
                args.choice_history,
            )
            clip_paths.append(clip_path)
        concat_segments(clip_paths, output_path, args.reencode or args.round_label or args.choice_history)
        print(f"Wrote video: {output_path}")
    finally:
        if temp_owner is not None:
            temp_owner.cleanup()


if __name__ == "__main__":
    main()
