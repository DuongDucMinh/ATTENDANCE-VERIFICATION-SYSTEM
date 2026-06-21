function resolveApiBase() {
  const envBase = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!envBase) {
    return "";
  }

  if (typeof window === "undefined") {
    return envBase;
  }

  const pageHost = window.location.hostname;
  const pageIsLocal = pageHost === "localhost" || pageHost === "127.0.0.1";
  const apiIsLocal = envBase.startsWith("http://localhost") || envBase.startsWith("http://127.0.0.1");

  return apiIsLocal && !pageIsLocal ? "" : envBase;
}

const API_BASE = resolveApiBase();

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.reason || "Yêu cầu thất bại.");
  }
  return data;
}

export async function fetchProfile(studentId) {
  return parseResponse(await fetch(`${API_BASE}/api/profile/${encodeURIComponent(studentId)}`));
}

export async function fetchRuntimeConfig() {
  return parseResponse(await fetch(`${API_BASE}/api/runtime-config`));
}

export async function upsertProfile(payload) {
  return parseResponse(
    await fetch(`${API_BASE}/api/profile/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function registerFace(studentId, poseLabel, file, captureMeta) {
  const formData = new FormData();
  formData.append("student_id", studentId);
  formData.append("pose_label", poseLabel);
  if (captureMeta) {
    formData.append("capture_meta", JSON.stringify(captureMeta));
  }
  formData.append("file", file, "register.jpg");
  return parseResponse(
    await fetch(`${API_BASE}/api/face/register`, {
      method: "POST",
      body: formData,
    }),
  );
}

export async function verifyAttendance(studentId, file, captureMeta) {
  const formData = new FormData();
  formData.append("student_id", studentId);
  if (captureMeta) {
    formData.append("capture_meta", JSON.stringify(captureMeta));
  }
  formData.append("file", file, "verify.jpg");
  return parseResponse(
    await fetch(`${API_BASE}/api/attendance/verify`, {
      method: "POST",
      body: formData,
    }),
  );
}
