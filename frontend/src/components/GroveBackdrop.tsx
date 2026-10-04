import { useMemo } from "react";

export const GroveBackdrop = () => {
  const fireflies = useMemo(
    () =>
      Array.from({ length: 16 }, () => ({
        left: `${Math.random() * 100}vw`,
        top: `${35 + Math.random() * 60}vh`,
        animationDelay: `${Math.random() * 8}s, ${Math.random() * 3}s`,
      })),
    [],
  );

  return (
    <div className="grove-backdrop" aria-hidden>
      <svg viewBox="0 0 1440 500" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
        <g fill="#12231a">
          <path d="M0 500 L0 260 L40 180 L80 260 L60 260 L110 150 L160 260 L140 260 L190 200 L240 500 Z" />
          <path d="M1180 500 L1220 210 L1260 120 L1300 210 L1280 210 L1340 90 L1400 230 L1380 230 L1440 170 L1440 500 Z" />
        </g>
        <g fill="#0f1d15">
          <path d="M200 500 L260 230 L300 140 L340 230 L320 230 L370 130 L420 500 Z" />
          <path d="M980 500 L1030 250 L1070 160 L1110 250 L1090 250 L1140 150 L1190 500 Z" />
        </g>
        <g fill="#1b2e23">
          <ellipse cx="760" cy="488" rx="90" ry="26" />
          <ellipse cx="300" cy="492" rx="70" ry="18" />
        </g>
      </svg>
      {fireflies.map((style, i) => (
        <span key={i} className="firefly" style={style} />
      ))}
    </div>
  );
};
