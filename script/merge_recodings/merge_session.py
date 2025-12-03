import os
import re
import subprocess
from supabase import create_client, Client

# ==== 設定 ====
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]  # サーバ用キー推奨
BUCKET = "pd-recordings"          # 実際のバケット名に合わせる
ROOT_PREFIX = "test_1203"         # 今の fileNamePrefix[0]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# mpd ファイル名のパターン
MPD_RE = re.compile(
    r"^(?P<sid>[0-9a-f]+)_(?P<channel>room-[^_]+)__uid_s_(?P<uid>\d+)__uid_e_av\.mpd$"
)

def list_room_folders():
    # test_1203/ 直下のフォルダ一覧（= safeChannel）
    items = supabase.storage.from_(BUCKET).list(ROOT_PREFIX)
    return [obj["name"] for obj in items if obj.get("name")]

def list_mpd_paths_for_room(safe_channel: str):
    prefix = f"{ROOT_PREFIX}/{safe_channel}"
    items = supabase.storage.from_(BUCKET).list(prefix)
    mpds = []
    for obj in items:
        name = obj["name"]
        if name.endswith(".mpd"):
            mpds.append(f"{prefix}/{name}")
    return mpds

def make_local_from_mpd_signed_url(mpd_path: str, out_dir: str):
    """
    Supabase 上の mpd への署名付きURLを取得 → ffmpeg で 1本の WebM を作る
    """
    # 署名付きURLを発行（非公開バケット前提）
    signed = supabase.storage.from_(BUCKET).create_signed_url(mpd_path, 60 * 60)
    mpd_url = signed["signedURL"]

    # ファイル名から uid を抽出
    filename = os.path.basename(mpd_path)
    m = MPD_RE.match(filename)
    if not m:
        print("skip (no match):", filename)
        return
    uid = m.group("uid")
    room = m.group("channel")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{room}_uid{uid}.webm")

    print("ffmpeg:", mpd_url, "->", out_path)
    subprocess.run(
        ["ffmpeg", "-y", "-i", mpd_url, "-c", "copy", out_path],
        check=True,
    )

def main():
    # 例: test_1203/ 配下の全 room を処理
    rooms = list_room_folders()
    print("rooms:", rooms)

    for safe_channel in rooms:
        mpd_paths = list_mpd_paths_for_room(safe_channel)
        print(f"[{safe_channel}] mpd:", mpd_paths)
        for mpd_path in mpd_paths:
            make_local_from_mpd_signed_url(mpd_path, out_dir="merged_videos")

if __name__ == "__main__":
    main()
