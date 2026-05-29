import { useEffect, useState } from "react";
import CameraSession from "./CameraSession";
import { fetchProfile, upsertProfile } from "../lib/api";

const defaultProfile = {
  student_id: "",
  full_name: "",
  has_face_registered: false,
  last_face_registered_at: null,
};

export default function ProfilePage({ profile, setProfile, registrationResult, setRegistrationResult }) {
  const [form, setForm] = useState(profile || defaultProfile);
  const [loading, setLoading] = useState(false);
  const [activeSession, setActiveSession] = useState(false);
  const [screen, setScreen] = useState("profile");
  const [notice, setNotice] = useState("Điền thông tin cá nhân và lưu hồ sơ trước khi đăng ký khuôn mặt.");

  useEffect(() => {
    setForm(profile || defaultProfile);
  }, [profile]);

  const onChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const saved = await upsertProfile(form);
      setProfile(saved);
      localStorage.setItem("attendance.profile.student_id", saved.student_id);
      setNotice("Đã lưu hồ sơ cá nhân.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const openRegistrationScreen = () => {
    setRegistrationResult(null);
    setScreen("register");
    setActiveSession(false);
  };

  if (screen === "register") {
    return (
      <div className="page-grid single">
        <section className="panel register-workspace">
          <div className="panel-heading">
            <div className="panel-heading-row">
              <div>
                <h2>Đăng ký khuôn mặt</h2>
                <p>
                  Mã sinh viên: <strong>{form.student_id || "--"}</strong>
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

          {activeSession ? (
            <CameraSession
              mode="register"
              studentId={form.student_id}
              active={activeSession}
              onStop={() => setActiveSession(false)}
              onComplete={async (result) => {
                setRegistrationResult(result);
                setActiveSession(false);
                try {
                  const refreshed = await fetchProfile(form.student_id);
                  setProfile(refreshed);
                } catch {
                  // Keep previous profile if refresh fails.
                }
              }}
            />
          ) : (
            <div className="result-shell">
              {registrationResult ? (
                <article className={`result-card ${registrationResult.ok ? "success" : "error"}`}>
                  <h3>{registrationResult.ok ? "Đăng ký thành công" : "Đăng ký thất bại"}</h3>
                  <p>Mã sinh viên: {registrationResult.studentId}</p>
                  <p>Thời gian: {new Date(registrationResult.createdAt).toLocaleString("vi-VN")}</p>
                  {registrationResult.reason ? <p>Lý do: {registrationResult.reason}</p> : null}
                </article>
              ) : (
                <article className="empty-state">
                  <h3>Sẵn sàng đăng ký</h3>
                  <p>Đặt khuôn mặt vào khung, giữ đúng tư thế và chớp mắt một lần khi hệ thống yêu cầu.</p>
                </article>
              )}
              <div className="button-strip">
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => {
                    setRegistrationResult(null);
                    setActiveSession(true);
                  }}
                >
                  Bắt đầu đăng ký
                </button>
                <button
                  className="ghost-btn"
                  type="button"
                  onClick={() => setScreen("profile")}
                >
                  Về thông tin cá nhân
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="page-grid">
      <section className="panel">
        <div className="panel-heading">
          <h2>Thông tin cá nhân</h2>
          <p>{notice}</p>
        </div>
        <form className="profile-form" onSubmit={saveProfile}>
          <label>
            <span>Mã sinh viên</span>
            <input name="student_id" value={form.student_id} onChange={onChange} placeholder="2026_SV01" />
          </label>
          <label>
            <span>Họ và tên</span>
            <input name="full_name" value={form.full_name || ""} onChange={onChange} placeholder="Nguyễn Văn A" />
          </label>
          <div className="button-strip">
            <button className="primary-btn" type="submit" disabled={loading}>
              {loading ? "Đang lưu..." : "Lưu hồ sơ"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Đăng ký khuôn mặt</h2>
          <p>
            {profile?.has_face_registered
              ? `Đã đăng ký lần gần nhất vào ${new Date(profile.last_face_registered_at).toLocaleString("vi-VN")}.`
              : "Chưa có khuôn mặt nào được đăng ký cho hồ sơ này."}
          </p>
        </div>

        <div className="result-shell">
          {registrationResult ? (
            <article className={`result-card ${registrationResult.ok ? "success" : "error"}`}>
              <h3>{registrationResult.ok ? "Đăng ký thành công" : "Đăng ký thất bại"}</h3>
              <p>Mã sinh viên: {registrationResult.studentId}</p>
              <p>Thời gian: {new Date(registrationResult.createdAt).toLocaleString("vi-VN")}</p>
              {registrationResult.reason ? <p>Lý do: {registrationResult.reason}</p> : null}
            </article>
          ) : (
            <article className="empty-state">
              <h3>Cách dùng</h3>
              <p>Lưu hồ sơ với mã sinh viên trước, sau đó bấm Đăng ký khuôn mặt để mở màn hình camera riêng.</p>
            </article>
          )}
          <button
            className="primary-btn"
            type="button"
            disabled={!form.student_id.trim()}
            onClick={openRegistrationScreen}
          >
            Mở màn hình đăng ký khuôn mặt
          </button>
        </div>
      </section>
    </div>
  );
}
