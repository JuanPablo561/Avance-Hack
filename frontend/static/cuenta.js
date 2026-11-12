(() => {
  const el = (id) => document.getElementById(id);
  let page = 1,
    user = null;
  async function api(path, options) {
    const r = await fetch("/api" + path, options);
    const data = r.status === 204 ? {} : await r.json();
    if (!r.ok) {
      if (r.status === 401) show(null);
      throw new Error(data.error || "No se pudo completar la operación.");
    }
    return data;
  }
  function show(value) {
    user = value;
    el("auth").hidden = !!user;
    el("salir").hidden = !user;
    el("herramienta").hidden = !user;
    el("sesion").textContent = user
      ? `Hola, ${user.name}. Tu historial es privado.`
      : "Inicia sesión o crea una cuenta para analizar y guardar resultados.";
    if (!user) {
      el("listaHistorial").replaceChildren();
      window.dispatchEvent(new Event("sesion-cerrada"));
    }
  }
  async function history() {
    if (!user) return;
    el("historyError").hidden = true;
    try {
      const data = await api("/analyses?page=" + page);
      el("listaHistorial").replaceChildren();
      for (const row of data.data) {
        const li = document.createElement("li");
        const categories = row.result.detecciones
          .map((d) => d.clase)
          .join(", ");
        li.textContent = `${row.filename} · ${new Date(row.created_at).toLocaleString("es-MX")} · ${categories || "Sin detecciones"}`;
        el("listaHistorial").append(li);
      }
      if (!data.data.length) {
        const li = document.createElement("li");
        li.textContent = "No hay análisis en esta página.";
        el("listaHistorial").append(li);
      }
      el("pagina").textContent = `Página ${page}`;
      el("anterior").disabled = page === 1;
      el("siguiente").disabled = data.data.length < 20;
    } catch (e) {
      el("historyError").textContent = e.message;
      el("historyError").hidden = false;
    }
  }
  async function authenticate(register) {
    if (!el("auth").reportValidity()) return;
    el("authError").hidden = true;
    el("auth")
      .querySelectorAll("button")
      .forEach((b) => (b.disabled = true));
    try {
      const data = await api(register ? "/register" : "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: el("nombre").value,
          email: el("correo").value,
          password: el("clave").value,
        }),
      });
      el("clave").value = "";
      show(data.user);
      page = 1;
      await history();
      el("elegir").focus();
    } catch (e) {
      el("authError").textContent = e.message;
      el("authError").hidden = false;
    } finally {
      el("auth")
        .querySelectorAll("button")
        .forEach((b) => (b.disabled = false));
    }
  }
  el("auth").addEventListener("submit", (e) => {
    e.preventDefault();
    authenticate(false);
  });
  el("registro").addEventListener("click", () => authenticate(true));
  el("salir").addEventListener("click", async () => {
    try {
      await api("/logout", { method: "POST" });
      show(null);
    } catch (e) {
      el("authError").textContent = e.message;
      el("authError").hidden = false;
    }
  });
  el("anterior").addEventListener("click", () => {
    if (page > 1) {
      page--;
      history();
    }
  });
  el("siguiente").addEventListener("click", () => {
    page++;
    history();
  });
  window.addEventListener("analisis-guardado", () => {
    page = 1;
    history();
  });
  api("/me")
    .then((data) => {
      show(data.user);
      history();
    })
    .catch((e) => {
      show(null);
      if (
        e.message !== "Inicia sesión para continuar." &&
        e.message !== "La sesión expiró."
      ) {
        el("authError").textContent = e.message;
        el("authError").hidden = false;
      }
    });
})();
