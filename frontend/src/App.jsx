import { useEffect, useMemo, useState } from "react";
import AttendancePage from "./components/AttendancePage";
import ProfilePage from "./components/ProfilePage";

const NAV_ITEMS = [
  { key: "profile", label: "Thông tin cá nhân" },
  { key: "attendance", label: "Điểm danh" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("profile");
  const [profile, setProfile] = useState({
    student_id: localStorage.getItem("attendance.profile.student_id") || "",
    full_name: "",
    has_face_registered: false,
    last_face_registered_at: null,
    registered_pose_labels: [],
    registered_sample_count: 0,
  });
  const [registrationResult, setRegistrationResult] = useState(null);

  useEffect(() => {
    if (profile?.student_id) {
      localStorage.setItem("attendance.profile.student_id", profile.student_id);
    }
  }, [profile]);

  const heroText = useMemo(
    () =>
      activeTab === "profile"
        ? "Quản lý hồ sơ cá nhân và đăng ký khuôn mặt."
        : "Bắt đầu điểm danh, xác minh xong là kết thúc phiên.",
    [activeTab],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">EDGE-AI ATTENDANCE</p>
          <h1>Attendance Verification</h1>
          <p>{heroText}</p>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`nav-btn ${activeTab === item.key ? "active" : ""}`}
              onClick={() => setActiveTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="content-area">
        {activeTab === "profile" ? (
          <ProfilePage
            profile={profile}
            setProfile={setProfile}
            registrationResult={registrationResult}
            setRegistrationResult={setRegistrationResult}
          />
        ) : (
          <AttendancePage defaultStudentId={profile.student_id} />
        )}
      </main>
    </div>
  );
}
