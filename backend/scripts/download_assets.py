import urllib.request
import os

# Target directory
dest_dir = r"d:\Python\project\ATTENDANCE-VERIFICATION\ATTENDANCE-VERIFICATION-SYSTEM\frontend\public\libs\mediapipe"
os.makedirs(dest_dir, exist_ok=True)

# List of assets to download to ensure 100% complete self-host
cdn_base = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh"
files_to_download = [
    "face_mesh_solution_packed_assets.data",
    "face_mesh_solution_packed_assets_loader.js",
]

print("Starting download of missing MediaPipe assets from CDN...")
for file in files_to_download:
    url = f"{cdn_base}/{file}"
    dest_path = os.path.join(dest_dir, file)
    print(f"Downloading {url} to {dest_path}...")
    try:
        urllib.request.urlretrieve(url, dest_path)
        print(f"Successfully downloaded {file}")
    except Exception as e:
        print(f"Failed to download {file}: {e}")

print("All downloads finished.")
