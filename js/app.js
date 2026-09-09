(() => {
  const buttons = document.querySelectorAll("button.tab-btn");
  const panels = document.querySelectorAll(".tab-panel");
  const VALID = new Set(["wrc", "score", "schools"]);

  function activate(id) {
    if (!VALID.has(id)) id = "wrc";
    buttons.forEach((btn) => {
      const active = btn.dataset.tab === id;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    panels.forEach((panel) => {
      panel.classList.toggle("active", panel.id === `panel-${id}`);
    });
    history.replaceState(null, "", `#${id}`);
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => activate(btn.dataset.tab));
  });

  const hash = location.hash.replace("#", "");
  activate(VALID.has(hash) ? hash : "wrc");
})();
