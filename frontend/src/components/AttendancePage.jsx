import { useEffect, useState } from "react";
import CameraSession, { unlockAndPreloadAudio } from "./CameraSession";
import { fetchRuntimeConfig } from "../lib/api";

export default function AttendancePage({ defaultStudentId }) {
  const [studentId, setStudentId] = useState(defaultStudentId || "");
  const [activeSession, setActiveSession] = useState(false);
  const [result, setResult] = useState(null);
  const [runtimeConfig, setRuntimeConfig] = useState(null);
  const decision = result?.meta?.decision_breakdown || null;

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

  if (activeSession) {
    return (
      <CameraSession
        mode="verify"
        studentId={studentId}
        active={activeSession}
        onStop={() => setActiveSession(false)}
        onComplete={(sessionResult) => {
          setResult(sessionResult);
          setActiveSession(false);
        }}
      />
    );
  }

  return (
    <div className="page-grid single">
      <section className="panel">
        <div className="panel-heading">
          <h2>Điểm danh</h2>

        </div>

        <label className="inline-field" style={{ marginTop: '16px' }}>
          <span>Mã sinh viên</span>
          <input value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="2026_SV01" />
        </label>

        <div className="result-shell">
          {result ? (
            <article className={`result-card ${result.ok ? "success" : "error"}`}>
              <h3>{result.ok ? "Điểm danh thành công" : "Điểm danh thất bại"}</h3>
              <p>Mã sinh viên: {result.studentId}</p>
              <p>Thời gian: {new Date(result.createdAt).toLocaleString("vi-VN")}</p>
              {typeof result.score === "number" ? <p>Điểm hybrid similarity: {result.score.toFixed(3)}</p> : null}
              {typeof decision?.threshold === "number" ? <p>Ngưỡng: {decision.threshold.toFixed(3)}</p> : null}

              {result.reason ? <p>Lý do: {result.reason}</p> : null}
            </article>
          ) : null}
          <button
            className="primary-btn"
            type="button"
            disabled={!studentId.trim()}
            onClick={() => {
              unlockAndPreloadAudio();
              setResult(null);
              setActiveSession(true);
            }}
          >
            Bắt đầu điểm danh
          </button>
        </div>
      </section>
    </div>
  );
}
