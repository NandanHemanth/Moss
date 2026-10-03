// Shared mockup behaviour: theme toggle, grove backdrop, voice notifications (Web Speech stand-in for ElevenLabs).
(function () {
  const root = document.documentElement;
  const saved = localStorage.getItem("moss-theme") || "notebook";
  root.setAttribute("data-theme", saved);

  const GROVE_SVG = `
  <svg viewBox="0 0 1440 500" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
    <g fill="#12231a">
      <path d="M0 500 L0 260 L40 180 L80 260 L60 260 L110 150 L160 260 L140 260 L190 200 L240 500 Z"/>
      <path d="M1180 500 L1220 210 L1260 120 L1300 210 L1280 210 L1340 90 L1400 230 L1380 230 L1440 170 L1440 500 Z"/>
    </g>
    <g fill="#0f1d15">
      <path d="M200 500 L260 230 L300 140 L340 230 L320 230 L370 130 L420 500 Z"/>
      <path d="M980 500 L1030 250 L1070 160 L1110 250 L1090 250 L1140 150 L1190 500 Z"/>
      <rect x="560" y="300" width="22" height="200"/>
      <circle cx="571" cy="270" r="80"/>
      <circle cx="520" cy="310" r="55"/>
      <circle cx="625" cy="305" r="60"/>
    </g>
    <g fill="#1b2e23">
      <ellipse cx="760" cy="488" rx="90" ry="26"/>
      <ellipse cx="820" cy="470" rx="46" ry="30"/>
      <ellipse cx="300" cy="492" rx="70" ry="18"/>
    </g>
    <g fill="#3d6b3a" opacity=".55">
      <ellipse cx="800" cy="452" rx="30" ry="8"/>
      <ellipse cx="740" cy="468" rx="40" ry="7"/>
    </g>
    <g>
      <rect x="880" y="470" width="5" height="18" fill="#d9cdb4"/>
      <ellipse cx="882" cy="470" rx="13" ry="8" fill="#b5523e"/>
      <rect x="902" y="478" width="4" height="12" fill="#d9cdb4"/>
      <ellipse cx="904" cy="478" rx="9" ry="6" fill="#c9735b"/>
    </g>
    <g fill="#0a130e" opacity=".9">
      <path d="M1040 470 q10 -26 24 -6 q8 -14 14 0 l4 20 h-46 z"/>
      <circle cx="1052" cy="452" r="3" fill="#e8d36a"/>
    </g>
  </svg>`;

  function mountGrove() {
    if (document.querySelector(".grove-bg")) return;
    const bg = document.createElement("div");
    bg.className = "grove-bg";
    bg.innerHTML = GROVE_SVG;
    for (let i = 0; i < 18; i++) {
      const f = document.createElement("span");
      f.className = "firefly";
      f.style.left = Math.random() * 100 + "vw";
      f.style.top = 30 + Math.random() * 65 + "vh";
      f.style.animationDelay = `${Math.random() * 8}s, ${Math.random() * 3}s`;
      bg.appendChild(f);
    }
    document.body.prepend(bg);
  }

  function setTheme(t) {
    root.setAttribute("data-theme", t);
    localStorage.setItem("moss-theme", t);
    document.querySelectorAll("[data-theme-label]").forEach((el) => {
      el.textContent = t === "grove" ? "Enchanted Grove" : "Notebook";
    });
    document.querySelectorAll("[data-theme-icon]").forEach((el) => {
      el.setAttribute("data-lucide", t === "grove" ? "moon" : "sun");
    });
    if (window.lucide) lucide.createIcons();
  }

  // Voice: the real app streams ElevenLabs audio; mockups use the browser's speech engine.
  let muted = localStorage.getItem("moss-muted") === "1";
  function setMuted(m) {
    muted = m;
    localStorage.setItem("moss-muted", m ? "1" : "0");
    document.querySelectorAll("[data-mute-icon]").forEach((el) => {
      el.setAttribute("data-lucide", m ? "volume-x" : "volume-2");
    });
    document.querySelectorAll("[data-toggle-mute]").forEach((b) => {
      b.title = m ? "Unmute voice" : "Mute voice";
      b.setAttribute("aria-label", b.title);
    });
    if (m && window.speechSynthesis) speechSynthesis.cancel();
    if (window.lucide) lucide.createIcons();
  }

  function notify(text, agent) {
    let stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `<div class="faint">${agent || "Elder Oak"} · just now</div><div>${text}</div>`;
    stack.appendChild(t);
    setTimeout(() => t.remove(), 6000);
    if (!muted && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      speechSynthesis.speak(u);
    }
  }

  window.Moss = { setTheme, setMuted, notify, isMuted: () => muted };

  document.addEventListener("DOMContentLoaded", () => {
    mountGrove();
    setTheme(root.getAttribute("data-theme"));
    setMuted(muted);
    document.querySelectorAll("[data-toggle-theme]").forEach((b) =>
      b.addEventListener("click", () =>
        setTheme(root.getAttribute("data-theme") === "grove" ? "notebook" : "grove")
      )
    );
    document.querySelectorAll("[data-toggle-mute]").forEach((b) =>
      b.addEventListener("click", () => setMuted(!muted))
    );
    document.querySelectorAll(".tabs").forEach((tabs) =>
      tabs.addEventListener("click", (e) => {
        const tab = e.target.closest(".tab");
        if (!tab) return;
        tabs.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
        tab.classList.add("active");
      })
    );
    document.querySelectorAll(".chip[data-toggle]").forEach((c) =>
      c.addEventListener("click", () => c.classList.toggle("on"))
    );
    if (window.lucide) lucide.createIcons();
  });
})();
