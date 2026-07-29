(() => {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  function activate(id) {
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
  if (hash === "score" || hash === "wrc") activate(hash);
  else activate("wrc");
})();
