import { useEffect, useState } from "react";
import CameraSession, { unlockAndPreloadAudio } from "./CameraSession";
import { fetchProfile, upsertProfile } from "../lib/api";

export default function ProfilePage({
  profile,
  setProfile,
  registrationResult,
  setRegistrationResult,
}) {
  // Inputs for registration
  const [regStudentId, setRegStudentId] = useState("");
  const [regFullName, setRegFullName] = useState("");

  const [activeSession, setActiveSession] = useState(false);
  const [screen, setScreen] = useState("profile"); // 'profile', 'register'

  const handleOpenRegistration = (event) => {
    event.preventDefault();
    if (!regStudentId.trim() || !regFullName.trim()) return;
    unlockAndPreloadAudio();
    setRegistrationResult(null);
    setScreen("register");
    setActiveSession(true);
  };

  if (screen === "register") {
    if (activeSession) {
      return (
        <CameraSession
          mode="register"
          studentId={regStudentId}
          active={activeSession}
          onStop={() => {
            setActiveSession(false);
            setScreen("profile");
          }}
          onComplete={async (result) => {
            setRegistrationResult(result);
            setActiveSession(false);
            if (result && result.ok) {
              try {
                const saved = await upsertProfile({
                  student_id: regStudentId.trim(),
                  full_name: regFullName.trim(),
                });
                setProfile(saved);
                localStorage.setItem("attendance.profile.student_id", saved.student_id);
              } catch (error) {
                console.error("Lỗi lưu hồ sơ sau đăng ký:", error);
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
            <h2 className="panel-title">Đăng ký hồ sơ & khuôn mặt</h2>
          </div>

          <div style={{ textAlign: "center", marginBottom: "20px", display: "flex", flexDirection: "column", gap: "6px", color: "var(--text)" }}>
            <p style={{ margin: 0, fontSize: "1rem" }}>Mã sinh viên: <strong style={{ fontWeight: "700" }}>{regStudentId}</strong></p>
            <p style={{ margin: 0, fontSize: "1rem" }}>Họ và tên: <strong style={{ fontWeight: "700" }}>{regFullName}</strong></p>
          </div>

          <div className="result-shell">
            {registrationResult ? (
              <article className={`result-card ${registrationResult.ok ? "success" : "error"}`}>
                <h3 style={{ fontSize: "1.1rem", fontWeight: "700", marginBottom: "6px" }}>
                  {registrationResult.ok ? "Đăng ký thành công" : "Đăng ký thất bại"}
                </h3>
                <p style={{ margin: "0 0 6px 0", fontSize: "0.85rem", opacity: 0.8 }}>
                  Thời gian: {new Date().toLocaleString("vi-VN")}
                </p>
                {registrationResult.reason ? (
                  <p style={{ margin: "6px 0 0 0", borderTop: "1px dashed rgba(220, 38, 38, 0.15)", paddingTop: "6px" }}>
                    Lý do: {registrationResult.reason}
                  </p>
                ) : null}
              </article>
            ) : (
              <article className="empty-state" style={{ textAlign: "center", padding: "24px" }}>
                <p>Nhấp nút bên dưới để bắt đầu quét các góc khuôn mặt đăng ký.</p>
              </article>
            )}

            {!registrationResult && (
              <div className="button-strip" style={{ display: "flex", justifyContent: "center" }}>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => {
                    unlockAndPreloadAudio();
                    setRegistrationResult(null);
                    setActiveSession(true);
                  }}
                  style={{ width: "70%", justifyContent: "center" }}
                >
                  Bắt đầu đăng ký khuôn mặt
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page-grid single">
      <section className="panel">
        <div className="panel-heading">
          <h2 className="panel-title">Đăng ký hồ sơ & khuôn mặt</h2>
        </div>
        <form onSubmit={handleOpenRegistration} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <label className="inline-field">
              <span style={{ fontWeight: "600", fontSize: "0.95rem" }}>Mã sinh viên</span>
              <input
                value={regStudentId}
                onChange={(e) => setRegStudentId(e.target.value)}
                placeholder="ví dụ: 12345"
                required
              />
            </label>
            <label className="inline-field">
              <span style={{ fontWeight: "600", fontSize: "0.95rem" }}>Họ và tên</span>
              <input
                value={regFullName}
                onChange={(e) => setRegFullName(e.target.value)}
                placeholder="ví dụ: Nguyễn Văn A"
                required
              />
            </label>
          </div>
          <div className="button-strip" style={{ display: "flex", justifyContent: "center", marginTop: "12px" }}>
            <button
              className="primary-btn"
              type="submit"
              disabled={!regStudentId.trim() || !regFullName.trim()}
              style={{ width: "70%", justifyContent: "center" }}
            >
              Bắt đầu đăng ký
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
