import { useEffect, useState } from "react";
import AttendancePage from "./components/AttendancePage";
import ProfilePage from "./components/ProfilePage";

const NAV_ITEMS = [
  { key: "profile", label: "Đăng ký" },
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

  return (
    <div className="app-shell">
      <header className="top-bar" style={{ justifyContent: "center" }}>
        <div className="brand-title">
          <h2>Face Verify Attendance</h2>
        </div>
      </header>

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

      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`bottom-nav-btn ${activeTab === item.key ? "active" : ""}`}
            onClick={() => setActiveTab(item.key)}
          >
            <span className="nav-icon">
              {item.key === "profile" ? "📝" : "✅"}
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
