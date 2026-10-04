// Forest silhouette, mushrooms, a stag and fireflies. Only shown in the dark "Enchanted grove" theme
// (CSS), and the fireflies stop moving under prefers-reduced-motion.
const FLIES: Array<{ left: string; bottom: number; delay?: string }> = [
  { left: "12%", bottom: 150 },
  { left: "31%", bottom: 90, delay: "-2s" },
  { left: "58%", bottom: 170, delay: "-4s" },
  { left: "77%", bottom: 110, delay: "-1s" },
  { left: "90%", bottom: 200, delay: "-5s" },
  { left: "45%", bottom: 60, delay: "-3s" },
];

export function Scenery() {
  return (
    <>
      <svg className="scene" viewBox="0 0 1400 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <g fill="#0f2318" opacity=".9">
          <path d="M60 300 L110 120 L160 300Z" />
          <path d="M150 300 L215 70 L280 300Z" />
          <path d="M1120 300 L1190 60 L1260 300Z" />
          <path d="M1230 300 L1290 130 L1350 300Z" />
          <path d="M930 300 L975 160 L1020 300Z" />
        </g>
        <g fill="#16301f">
          <path d="M0 300 L60 170 L120 300Z" />
          <path d="M300 300 L350 150 L400 300Z" />
          <path d="M1320 300 L1370 150 L1420 300Z" />
          <path d="M1030 300 L1085 110 L1140 300Z" />
        </g>
        <path d="M0 300 C200 250 380 285 620 270 S1100 245 1400 282 L1400 300Z" fill="#1d4027" />
        <g fill="#3b4a41">
          <ellipse cx="470" cy="286" rx="46" ry="18" />
          <ellipse cx="528" cy="290" rx="28" ry="12" />
          <ellipse cx="860" cy="284" rx="38" ry="15" />
        </g>
        <g fill="#5d9a48" opacity=".85">
          <ellipse cx="462" cy="274" rx="30" ry="7" />
          <ellipse cx="856" cy="273" rx="24" ry="6" />
        </g>
        <g>
          <rect x="690" y="262" width="5" height="16" fill="#d9cfb8" />
          <path d="M678 264 a15 11 0 0 1 30 0Z" fill="#b6543c" />
          <rect x="716" y="268" width="4" height="11" fill="#d9cfb8" />
          <path d="M708 270 a10 8 0 0 1 20 0Z" fill="#b6543c" />
        </g>
        <g fill="#0a1a12">
          <path d="M585 268 q6-22 20-20 q-2-9 6-12 l4 9 q10 2 9 12 l-6 3 l1 10 l-5 0 l-2-8 l-14 1 l-3 7 l-5 0Z" />
        </g>
      </svg>
      {FLIES.map((f, i) => (
        <i key={i} className="fly" style={{ left: f.left, bottom: f.bottom, animationDelay: f.delay }} aria-hidden="true" />
      ))}
    </>
  );
}
