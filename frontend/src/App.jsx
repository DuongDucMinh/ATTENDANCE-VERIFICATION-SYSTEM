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
  const [profileKey, setProfileKey] = useState(0);
  const [attendanceKey, setAttendanceKey] = useState(0);

  useEffect(() => {
    if (profile?.student_id) {
      localStorage.setItem("attendance.profile.student_id", profile.student_id);
    }
  }, [profile]);

  return (
    <div className="app-shell">
      <header className="top-bar" style={{ justifyContent: "center" }}>
        <div className="brand-title">
          <span className="brand-dot" aria-hidden="true"></span>
          <h2>Điểm Danh Khuôn Mặt</h2>
        </div>
      </header>

      <main className="content-area">
        {activeTab === "profile" ? (
          <ProfilePage
            key={`profile-${profileKey}`}
            profile={profile}
            setProfile={setProfile}
            registrationResult={registrationResult}
            setRegistrationResult={setRegistrationResult}
          />
        ) : (
          <AttendancePage
            key={`attendance-${attendanceKey}`}
            defaultStudentId={profile.student_id}
          />
        )}
      </main>

      <nav className="bottom-nav" role="tablist" aria-label="Thanh điều hướng chính">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`bottom-nav-btn ${activeTab === item.key ? "active" : ""}`}
            role="tab"
            aria-selected={activeTab === item.key}
            onClick={() => {
              setActiveTab(item.key);
              if (item.key === "profile") {
                setRegistrationResult(null);
                setProfileKey((k) => k + 1);
              } else if (item.key === "attendance") {
                setAttendanceKey((k) => k + 1);
              }
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              {item.key === "profile" ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                  <line x1="22" y1="11" x2="16" y2="11" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              )}
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
