import { useEffect, useState } from "react";
import CameraSession, { unlockAndPreloadAudio } from "./CameraSession";
import { fetchRuntimeConfig, fetchProfile } from "../lib/api";

export default function AttendancePage({ defaultStudentId }) {
  const [studentId, setStudentId] = useState(defaultStudentId || "");
  const [studentName, setStudentName] = useState("");
  const [activeSession, setActiveSession] = useState(false);
  const [result, setResult] = useState(null);
  const [runtimeConfig, setRuntimeConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetchRuntimeConfig()
      .then((config) => {
        if (!cancelled) setRuntimeConfig(config);
      })
      .catch(() => {
        if (!cancelled) setRuntimeConfig(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleStartAttendance = () => {
    unlockAndPreloadAudio();
    setResult(null);
    setActiveSession(true);
  };

  if (activeSession) {
    return (
      <CameraSession
        mode="verify"
        studentId={studentId}
        active={activeSession}
        onStop={() => setActiveSession(false)}
        onComplete={async (sessionResult) => {
          setResult(sessionResult);
          setActiveSession(false);
          if (sessionResult) {
            try {
              const profile = await fetchProfile(studentId.trim());
              if (profile && profile.full_name) {
                setStudentName(profile.full_name);
              } else {
                setStudentName("Không tìm thấy");
              }
            } catch (err) {
              setStudentName("Không tìm thấy");
            }
          }
        }}
      />
    );
  }

  return (
    <div className="page-grid single">
      <section className="panel">
        <div className="panel-heading">
          <h2 className="panel-title">Điểm danh</h2>
        </div>

        {result ? (
          <div style={{ textAlign: "center", marginBottom: "20px", display: "flex", flexDirection: "column", gap: "6px", color: "var(--text)" }}>
            <p style={{ margin: 0, fontSize: "1rem" }}>Mã sinh viên: <strong style={{ fontWeight: "700" }}>{studentId}</strong></p>
            <p style={{ margin: 0, fontSize: "1rem" }}>Họ và tên: <strong style={{ fontWeight: "700" }}>{studentName || "--"}</strong></p>
          </div>
        ) : (
          <div style={{ marginBottom: "20px" }}>
            <label className="inline-field">
              <span style={{ fontWeight: "600", fontSize: "0.95rem" }}>Mã sinh viên</span>
              <input
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
                placeholder="ví dụ: 12345"
              />
            </label>
          </div>
        )}

        <div className="result-shell">
          {result ? (
            <article className={`result-card ${result.ok ? "success" : "error"}`}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: "700", marginBottom: "6px" }}>
                {result.ok ? "Điểm danh thành công" : "Điểm danh thất bại"}
              </h3>
              <p style={{ margin: "0 0 6px 0", fontSize: "0.85rem", opacity: 0.8 }}>
                Thời gian: {new Date(result.createdAt || Date.now()).toLocaleString("vi-VN")}
              </p>
              {result.reason ? (
                <p style={{ margin: "6px 0 0 0", borderTop: "1px dashed rgba(220, 38, 38, 0.15)", paddingTop: "6px" }}>
                  Lý do: {result.reason}
                </p>
              ) : null}
            </article>
          ) : (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button
                className="primary-btn"
                type="button"
                disabled={!studentId.trim()}
                onClick={handleStartAttendance}
                style={{ width: "70%", justifyContent: "center" }}
              >
                Bắt đầu điểm danh
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
