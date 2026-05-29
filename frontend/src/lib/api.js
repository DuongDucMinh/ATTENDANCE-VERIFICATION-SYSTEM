const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

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

export async function upsertProfile(payload) {
  return parseResponse(
    await fetch(`${API_BASE}/api/profile/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function registerFace(studentId, file) {
  const formData = new FormData();
  formData.append("student_id", studentId);
  formData.append("file", file, "register.jpg");
  return parseResponse(
    await fetch(`${API_BASE}/api/face/register`, {
      method: "POST",
      body: formData,
    }),
  );
}

export async function verifyAttendance(studentId, file) {
  const formData = new FormData();
  formData.append("student_id", studentId);
  formData.append("file", file, "verify.jpg");
  return parseResponse(
    await fetch(`${API_BASE}/api/attendance/verify`, {
      method: "POST",
      body: formData,
    }),
  );
}
