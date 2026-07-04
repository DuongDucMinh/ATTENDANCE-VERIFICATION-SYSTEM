import { useEffect, useState } from "react";
import CameraSession, { unlockAndPreloadAudio } from "./CameraSession";
import { fetchProfile, upsertProfile } from "../lib/api";

export default function ProfilePage({ profile, setProfile, registrationResult, setRegistrationResult }) {
  // Inputs for checking
  const [checkStudentId, setCheckStudentId] = useState("");
  const [checkResult, setCheckResult] = useState(null);
  const [checkLoading, setCheckLoading] = useState(false);

  // Inputs for registration
  const [regStudentId, setRegStudentId] = useState("");
  const [regFullName, setRegFullName] = useState("");

  const [activeSession, setActiveSession] = useState(false);
  const [screen, setScreen] = useState("profile");

  const handleCheck = async (event) => {
    event.preventDefault();
    if (!checkStudentId.trim()) return;
    setCheckLoading(true);
    setCheckResult(null);
    try {
      const data = await fetchProfile(checkStudentId.trim());
      if (data && data.full_name) {
        setCheckResult({
          student_id: data.student_id,
          full_name: data.full_name,
          has_face_registered: data.has_face_registered,
        });
      } else {
        setCheckResult({ notFound: true });
      }
    } catch (error) {
      setCheckResult({ notFound: true });
    } finally {
      setCheckLoading(false);
    }
  };

  const handleOpenRegistration = (event) => {
    event.preventDefault();
    if (!regStudentId.trim() || !regFullName.trim()) return;
    setRegistrationResult(null);
    setScreen("register");
    setActiveSession(false);
  };

  if (screen === "register") {
    if (activeSession) {
      return (
        <CameraSession
          mode="register"
          studentId={regStudentId}
          active={activeSession}
          onStop={() => setActiveSession(false)}
          onComplete={async (result) => {
            setRegistrationResult(result);
            setActiveSession(false);
            if (result && result.ok) {
              try {
                // Only save/update profile information when registration is successful!
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
        <section className="panel register-workspace">
          <div className="panel-heading">
            <div className="panel-heading-row">
              <div>
                <h2>Đăng ký khuôn mặt</h2>
                <p style={{ marginTop: "4px" }}>
                  Mã sinh viên: <strong>{regStudentId || "--"}</strong>
                </p>
              </div>
              <button
                className="ghost-btn"
                type="button"
                onClick={() => {
                  setActiveSession(false);
                  setScreen("profile");
                }}
              >
                Quay lại
              </button>
            </div>
          </div>

          <div className="result-shell">
            {registrationResult ? (
              <article className={`result-card ${registrationResult.ok ? "success" : "error"}`}>
                <h3>{registrationResult.ok ? "Đăng ký thành công" : "Đăng ký thất bại"}</h3>
                {registrationResult.reason ? <p>Lý do: {registrationResult.reason}</p> : null}
              </article>
            ) : (
              <article className="empty-state">
                <p>Nhấp nút bên dưới để bắt đầu đăng ký khuôn mặt.</p>
              </article>
            )}
            <div className="button-strip" style={{ display: "flex", justifyContent: "center" }}>
              <button
                className="primary-btn"
                type="button"
                onClick={() => {
                  unlockAndPreloadAudio();
                  setRegistrationResult(null);
                  setActiveSession(true);
                }}
                style={{ margin: "0 auto" }}
              >
                Bắt đầu đăng ký khuôn mặt
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page-grid single" style={{ gap: "12px", padding: "0 8px" }}>
      {/* Top instruction text - Tạm thời ẩn
      <div className="profile-instruction-header" style={{ textAlign: "center", fontSize: "0.85rem", color: "var(--muted)", lineHeight: "1.45", margin: "4px 0" }}>
        Hướng dẫn: Nhập mã sinh viên ở mục "KIỂM TRA THÔNG TIN" để kiểm tra thông tin đã được đăng ký chưa. Nếu chưa có thông tin trước đó hoặc muốn cập nhật lại khuôn mặt, vui lòng đăng ký ở mục “ĐĂNG KÝ KHUÔN MẶT”
      </div>
      */}

      {/* Panel 1: KIỂM TRA THÔNG TIN - Tạm thời ẩn
      <section className="panel" style={{ padding: "12px 18px" }}>
        <h2 style={{ textAlign: "center", fontSize: "1.1rem", marginBottom: "12px", letterSpacing: "0.03em" }}>KIỂM TRA THÔNG TIN</h2>
        <form onSubmit={handleCheck} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <label className="inline-field">
            <span>Mã sinh viên:</span>
            <input 
              value={checkStudentId} 
              onChange={(e) => setCheckStudentId(e.target.value)} 
              placeholder="Nhập mã sinh viên..." 
              required 
            />
          </label>
          <div className="button-strip" style={{ display: "flex", justifyContent: "center" }}>
            <button className="primary-btn" type="submit" disabled={checkLoading} style={{ minWidth: "140px" }}>
              {checkLoading ? "Đang kiểm tra..." : "Kiểm tra"}
            </button>
          </div>
        </form>

        {checkResult && (
          <div style={{ marginTop: "12px", padding: "10px 14px", borderRadius: "12px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.08)", fontSize: "0.88rem" }}>
            {checkResult.notFound ? (
              <p style={{ color: "var(--signal)", textAlign: "center", margin: 0, fontWeight: "500", lineHeight: "1.4" }}>
                Chưa có thông tin, hãy đăng ký thông tin và khuôn mặt ở mục bên dưới
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <p style={{ margin: 0 }}>Mã sinh viên: <strong>{checkResult.student_id}</strong></p>
                <p style={{ margin: 0 }}>Họ và tên: <strong>{checkResult.full_name}</strong></p>
                <p style={{ margin: 0 }}>
                  Đã đăng ký khuôn mặt:{" "}
                  <strong style={{ color: checkResult.has_face_registered ? "var(--good)" : "var(--signal)" }}>
                    {checkResult.has_face_registered ? "Đã đăng ký" : "Chưa đăng ký"}
                  </strong>
                </p>
              </div>
            )}
          </div>
        )}
      </section>
      */}

      {/* Panel 2: ĐĂNG KÝ KHUÔN MẶT */}
      <section className="panel" style={{ padding: "12px 18px" }}>
        <h2 style={{ textAlign: "center", fontSize: "1.1rem", marginBottom: "12px", letterSpacing: "0.03em" }}>ĐĂNG KÝ KHUÔN MẶT</h2>
        <form onSubmit={handleOpenRegistration} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <label className="inline-field">
              <span>Mã sinh viên:</span>
              <input 
                value={regStudentId} 
                onChange={(e) => setRegStudentId(e.target.value)} 
                placeholder="Nhập mã sinh viên..." 
                required 
              />
            </label>
            <label className="inline-field">
              <span>Họ và tên:</span>
              <input 
                value={regFullName} 
                onChange={(e) => setRegFullName(e.target.value)} 
                placeholder="Nhập họ và tên..." 
                required 
              />
            </label>
          </div>
          <div className="button-strip" style={{ display: "flex", justifyContent: "center" }}>
            <button 
              className="primary-btn" 
              type="submit"
              disabled={!regStudentId.trim() || !regFullName.trim()}
              style={{ minWidth: "140px" }}
            >
              Đăng ký
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
