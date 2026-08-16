/**
 * NPC LLM – Foundry VTT v13/v14
 *
 * Spieler schreiben im Chat:   !bogdan Wo kriegt man hier Fisch her?
 * GM öffnet das Panel per Makro: game.modules.get("npc-llm").api.panel()
 *
 * v14 hat den chatMessage-Hook durch ChatLog.CHAT_COMMANDS ersetzt. Statt uns
 * dort einzuklinken, hängen wir an preCreateChatMessage – das ist über alle
 * Versionen stabil. Deshalb ist das Präfix ein "!" und kein "/": Ein
 * Slash-Kommando fängt Foundry ab, bevor eine Nachricht entsteht.
 */

const MODULE_ID = "npc-llm";

/* ------------------------------------------------------------------ */
/* Einstellungen                                                       */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "serverUrl", {
    name: "Server-URL",
    hint: "Adresse des NPC-Dienstes, z. B. https://foundry.example.de/npc",
    scope: "world", config: true, type: String, default: "http://localhost:8787"
  });

  game.settings.register(MODULE_ID, "token", {
    name: "Zugangs-Token",
    hint: "Muss mit NPC_TOKEN auf dem Server übereinstimmen.",
    scope: "world", config: true, type: String, default: ""
  });

  game.settings.register(MODULE_ID, "npcId", {
    name: "Aktiver NPC",
    hint: "Dateiname ohne .json aus dem Ordner server/npcs/",
    scope: "world", config: true, type: String, default: "bogdan"
  });

  game.settings.register(MODULE_ID, "prefix", {
    name: "Chat-Präfix",
    hint: "Womit Spieler den NPC ansprechen. Kein Slash am Anfang.",
    scope: "world", config: true, type: String, default: "!bogdan"
  });

  game.settings.register(MODULE_ID, "active", {
    name: "NPC ansprechbar",
    hint: "Kann auch im Panel umgeschaltet werden.",
    scope: "world", config: true, type: Boolean, default: false
  });
});

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

function icStyle() {
  return CONST.CHAT_MESSAGE_STYLES?.IC ?? 2;
}

/** v14 schickt Chatinhalt als HTML durch ProseMirror. Wir wollen den Text. */
function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = String(html ?? "");
  return (div.textContent || "").replace(/\s+/g, " ").trim();
}

async function api(path, { method = "GET", body } = {}) {
  const base = game.settings.get(MODULE_ID, "serverUrl").replace(/\/+$/, "");
  const token = game.settings.get(MODULE_ID, "token");

  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`.trim());
  }
  return res.json();
}

function speakerName() {
  const token = canvas?.tokens?.controlled?.[0];
  if (token?.actor?.name) return token.actor.name;
  if (game.user.character?.name) return game.user.character.name;
  return game.user.name;
}

/* ------------------------------------------------------------------ */
/* Gespräch                                                            */
/* ------------------------------------------------------------------ */

async function talk(said) {
  const npcId = game.settings.get(MODULE_ID, "npcId");
  let busy;

  try {
    busy = ui.notifications.info("Er überlegt …", { permanent: true });

    const data = await api("/talk", {
      method: "POST",
      body: { npc: npcId, speaker: speakerName(), text: said }
    });

    await ChatMessage.create({
      content: `<div class="npc-llm-reply">${data.reply}</div>`,
      speaker: { alias: data.alias ?? "NPC" },
      style: icStyle(),
      flags: { [MODULE_ID]: { npc: npcId, generated: true } }
    });
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
    ui.notifications.error(`NPC antwortet nicht: ${err.message}`);
  } finally {
    if (busy !== undefined) ui.notifications.remove?.(busy);
  }
}

/* ------------------------------------------------------------------ */
/* Erkennung: normale Chatnachricht mit Präfix                         */
/* ------------------------------------------------------------------ */

Hooks.on("preCreateChatMessage", (message, data) => {
  // Nur auf dem Client, der die Nachricht abschickt – sonst antwortet der
  // NPC einmal pro verbundenem Spieler.
  if (data.author && data.author !== game.user.id) return true;
  if (data.user && data.user !== game.user.id) return true;

  const text = plainText(data.content);
  if (!text) return true;

  const prefix = game.settings.get(MODULE_ID, "prefix");
  if (!prefix || !text.toLowerCase().startsWith(prefix.toLowerCase())) return true;

  const said = text.slice(prefix.length).trim();
  if (!said) {
    ui.notifications.warn(`Beispiel: ${prefix} Wie heißt du?`);
    return false;
  }

  if (!game.settings.get(MODULE_ID, "active")) {
    ui.notifications.warn("Der NPC ist gerade nicht ansprechbar.");
    return false;
  }

  // Die Frage im Log stehen lassen, aber ohne das Präfix.
  message.updateSource({ content: said, style: icStyle() });

  talk(said);
  return true;
});

/* ------------------------------------------------------------------ */
/* GM-Panel                                                            */
/* ------------------------------------------------------------------ */

const { ApplicationV2 } = foundry.applications.api;

class NpcPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "npc-llm-panel",
    tag: "div",
    classes: ["npc-llm-panel"],
    window: { title: "NPC-Wissen", icon: "fa-solid fa-fish", resizable: false },
    position: { width: 440, height: "640" }
  };

  async _prepareContext() {
    const npcId = game.settings.get(MODULE_ID, "npcId");
    try {
      return await api(`/state/${encodeURIComponent(npcId)}`);
    } catch (err) {
      return { error: err.message };
    }
  }

  async _renderHTML(context) {
    if (context.error) {
      return `<p class="npc-llm-error">Kein Kontakt zum Server:<br><code>${context.error}</code></p>`;
    }

    const active = game.settings.get(MODULE_ID, "active");
    const prefix = game.settings.get(MODULE_ID, "prefix");

    const rows = context.tiers.map(t => {
      const blocked = t.requires && !context.tiers.find(x => x.id === t.requires)?.unlocked;
      return `
        <li class="npc-llm-tier ${blocked ? "is-blocked" : ""}">
          <label>
            <input type="checkbox" data-tier="${t.id}"
                   ${t.unlocked ? "checked" : ""} ${blocked ? "disabled" : ""}>
            <span class="npc-llm-label">${t.label}</span>
          </label>
          ${t.requires ? `<span class="npc-llm-req">braucht: ${t.requires}</span>` : ""}
          <p class="npc-llm-preview">${t.preview}</p>
        </li>`;
    }).join("");

    return `
      <header class="npc-llm-head">
        <strong>${context.alias}</strong>
        <label class="npc-llm-toggle">
          <input type="checkbox" data-action="active" ${active ? "checked" : ""}>
          ansprechbar über <code>${prefix}</code>
        </label>
      </header>
      <p class="npc-llm-hint">Haken setzen, sobald eine Probe gelungen ist. Was nicht
      angehakt ist, steht dem Modell gar nicht erst zur Verfügung.</p>
      <ul class="npc-llm-tiers">${rows}</ul>
      <footer class="npc-llm-foot">
        <span>${context.historyLength} Nachrichten im Gedächtnis</span>
        <button type="button" data-action="reset">Gespräch vergessen</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;

    content.querySelectorAll("input[data-tier]").forEach(box => {
      box.addEventListener("change", async ev => {
        try {
          await api("/unlock", {
            method: "POST",
            body: {
              npc: game.settings.get(MODULE_ID, "npcId"),
              tier: ev.currentTarget.dataset.tier,
              unlocked: ev.currentTarget.checked
            }
          });
          this.render();
        } catch (err) { ui.notifications.error(err.message); }
      });
    });

    content.querySelector('[data-action="active"]')?.addEventListener("change", async ev => {
      await game.settings.set(MODULE_ID, "active", ev.currentTarget.checked);
    });

    content.querySelector('[data-action="reset"]')?.addEventListener("click", async () => {
      try {
        await api("/reset", {
          method: "POST",
          body: { npc: game.settings.get(MODULE_ID, "npcId") }
        });
        ui.notifications.info("Er weiß nicht mehr, worüber ihr geredet habt.");
        this.render();
      } catch (err) { ui.notifications.error(err.message); }
    });
  }
}

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { panel: () => new NpcPanel().render(true) };
  if (game.user.isGM) console.log(`${MODULE_ID} | bereit (v14-Modus).`);
});
