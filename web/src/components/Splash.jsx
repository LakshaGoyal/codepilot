import { useEffect, useState } from "react";

export default function Splash({ onFinish }) {
  const [fading, setFading] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // Display for ~750ms, then start a 300ms fade-out transition (~1050ms total duration)
    const fadeTimer = setTimeout(() => {
      setFading(true);
    }, 1000);

    const finishTimer = setTimeout(() => {
      setHidden(true);
      if (onFinish) onFinish();
    }, 3000);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(finishTimer);
    };
  }, [onFinish]);

  if (hidden) return null;

  return (
    <div className={`splash-overlay ${fading ? "splash-fade-out" : ""}`}>
      <div className="splash-content">
        <span className="splash-title">CodePilot</span>
      </div>
    </div>
  );
}
