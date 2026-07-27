"use client";

import { useEffect, useState } from "react";

const SPLASH_KEY = "lumagrade-intro-seen";

export default function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const hasSeenIntro = window.sessionStorage.getItem(SPLASH_KEY) === "1";

    if (reduceMotion || hasSeenIntro) {
      const skipFrame = window.requestAnimationFrame(() => setVisible(false));
      return () => window.cancelAnimationFrame(skipFrame);
    }

    const leaveTimer = window.setTimeout(() => setLeaving(true), 2250);
    const removeTimer = window.setTimeout(() => {
      setVisible(false);
      window.sessionStorage.setItem(SPLASH_KEY, "1");
    }, 2850);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(removeTimer);
    };
  }, []);

  const dismiss = () => {
    setLeaving(true);
    window.sessionStorage.setItem(SPLASH_KEY, "1");
    window.setTimeout(() => setVisible(false), 520);
  };

  if (!visible) return null;

  return (
    <div
      className={`splashScreen${leaving ? " isLeaving" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="LumaGrade 正在启动"
    >
      <div className="splashNoise" />
      <div className="splashAurora splashAuroraOne" />
      <div className="splashAurora splashAuroraTwo" />
      <div className="splashContent">
        <div className="splashLogoWrap">
          <span className="splashLogo">Lg</span>
          <span className="splashOrbit" />
          <span className="splashFlare" />
        </div>
        <div className="splashWordmark">
          <strong>LUMAGRADE</strong>
          <span>COLOR INTELLIGENCE STUDIO</span>
        </div>
        <div className="splashProgress">
          <i />
        </div>
        <small>正在校准色彩引擎</small>
      </div>
      <button className="splashSkip" onClick={dismiss}>
        跳过
      </button>
    </div>
  );
}
