import { useEffect, useState } from "react";
import CameraSession from "./CameraSession";
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

  return (
    <div className="page-grid single">
      <section className="panel">
        <div className="panel-heading">
          <h2>Điểm danh</h2>
          <p>Phiên điểm danh sẽ tạo challenge ngẫu nhiên 2 bước. Sau khi challenge đạt, hệ thống sẽ chụp thêm 1 ảnh mặt thẳng ổn định rồi mới gửi lên backend để tính hybrid similarity.</p>
          {typeof runtimeConfig?.similarity_threshold === "number" ? (
            <p>
              Threshold backend runtime: {runtimeConfig.similarity_threshold.toFixed(3)}
              {runtimeConfig?.similarity_threshold_source ? ` (${runtimeConfig.similarity_threshold_source})` : ""}
            </p>
          ) : null}
        </div>

        <label className="inline-field">
          <span>Mã sinh viên</span>
          <input value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="2026_SV01" />
        </label>

        {!activeSession ? (
          <div className="result-shell">
            {result ? (
              <article className={`result-card ${result.ok ? "success" : "error"}`}>
                <h3>{result.ok ? "Điểm danh thành công" : "Điểm danh thất bại"}</h3>
                <p>Mã sinh viên: {result.studentId}</p>
                <p>Thời gian: {new Date(result.createdAt).toLocaleString("vi-VN")}</p>
                {typeof result.score === "number" ? <p>Điểm hybrid similarity: {result.score.toFixed(3)}</p> : null}
                {typeof decision?.threshold === "number" ? <p>Threshold đang dùng: {decision.threshold.toFixed(3)}</p> : null}
                {typeof decision?.raw_match_score === "number" ? <p>Raw match score: {decision.raw_match_score.toFixed(3)}</p> : null}
                {result.reason ? <p>Lý do: {result.reason}</p> : null}
              </article>
            ) : (
              <article className="empty-state">
                <h3>Phiên điểm danh chưa bắt đầu</h3>
                <p>Camera chỉ mở khi bạn bấm bắt đầu và sẽ tự tắt sau khi có kết quả.</p>
              </article>
            )}
            <button
              className="primary-btn"
              type="button"
              disabled={!studentId.trim()}
              onClick={() => {
                setResult(null);
                setActiveSession(true);
              }}
            >
              Bắt đầu điểm danh
            </button>
          </div>
        ) : (
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
        )}
      </section>
    </div>
  );
}
