// ALM7 & 5th iLS Conference — live Google Sheets powered app

const CONFIG = window.CONFERENCE_CONFIG;

const DB = {
  program: [],
  sessions: [],
  presentations: [],
  abstracts: [],
  speakers: [],
  venues: [],
  announcements: [],
  sponsors: [],
  sponsorLoadError: "",
  settings: {},
  loaded: false
};

let selectedProgramDate = "2026-10-18";
let selectedProgramFilter = "All";

const FILTER_ORDER = [
  "All", "Plenary", "Keynote", "Session", "Workshop", "Poster", "Break",
  "Lunch", "Registration", "AGM", "Social", "Opening", "Awards", "Closing", "Other"
];

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normaliseDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const au = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (au) return `${au[3]}-${String(au[2]).padStart(2,"0")}-${String(au[1]).padStart(2,"0")}`;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,"0")}-${String(parsed.getDate()).padStart(2,"0")}`;
  }
  return s;
}

function normaliseTime(value) {
  if (!value) return "";
  const s = String(value).trim();
  const match = s.match(/(\d{1,2}):(\d{2})/);
  if (match) return `${String(Number(match[1])).padStart(2,"0")}:${match[2]}`;
  return s;
}

function parseMinutes(t) {
  if (!t || !String(t).includes(":")) return 0;
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}

function formatTime(t) {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return String(t);
  const suffix = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2,"0")} ${suffix}`;
}

function formatDate(dateString, options = {}) {
  if (!dateString) return "";
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("en-AU", {
    weekday: options.short ? "short" : "long",
    day: "numeric",
    month: options.short ? "short" : "long"
  });
}

function dateRangeLabel(start, end) {
  if (!start || !end) return "18–21 October 2026";
  const s = new Date(`${start}T12:00:00`);
  const e = new Date(`${end}T12:00:00`);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.getDate()} ${e.toLocaleDateString("en-AU", {month:"long"})} ${e.getFullYear()}`;
  }
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function getPerthNowParts() {
  const tz = DB.settings.Timezone || CONFIG.timezone || "Australia/Perth";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function daysBetween(a, b) {
  const d1 = new Date(`${a}T12:00:00`);
  const d2 = new Date(`${b}T12:00:00`);
  return Math.ceil((d2 - d1) / 86400000);
}

let loadingIndicatorTimer = null;

function showLoadingIndicator() {
  const el = document.querySelector("#data-status");
  if (!el) return;
  clearTimeout(loadingIndicatorTimer);
  loadingIndicatorTimer = setTimeout(() => {
    el.className = "data-status loading";
    el.innerHTML = '<span class="loading-spinner" aria-hidden="true"></span><span class="sr-only">Loading conference program</span>';
    el.hidden = false;
    el.style.display = "grid";
  }, 350);
}

function hideDataStatus() {
  clearTimeout(loadingIndicatorTimer);
  loadingIndicatorTimer = null;
  const el = document.querySelector("#data-status");
  if (!el) return;
  el.hidden = true;
  el.style.display = "none";
  el.className = "data-status";
  el.innerHTML = "";
}

function showDataError(message = "We’re having trouble loading the program. Please refresh and try again.") {
  clearTimeout(loadingIndicatorTimer);
  const el = document.querySelector("#data-status");
  if (!el) return;
  el.className = "data-status error";
  el.textContent = message;
  el.hidden = false;
  el.style.display = "block";
}

// Google Visualization JSONP loader. This avoids CORS problems when testing the app locally.
function loadSheet(sheetName, range) {
  return new Promise((resolve, reject) => {
    const callbackName = `__sheet_${sheetName}_${Date.now()}_${Math.floor(Math.random()*10000)}`;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${sheetName} timed out`));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = response => {
      try {
        if (!response || response.status === "error" || !response.table) {
          throw new Error(response?.errors?.[0]?.detailed_message || `Could not read ${sheetName}`);
        }
        const cols = response.table.cols.map((col, i) => col.label || col.id || `Column${i+1}`);
        const rows = response.table.rows.map(row => {
          const obj = {};
          cols.forEach((col, i) => {
            const cell = row.c?.[i];
            if (!cell) obj[col] = "";
            else if (cell.f !== undefined && cell.f !== null) obj[col] = cell.f;
            else obj[col] = cell.v ?? "";
          });
          return obj;
        });
        cleanup();
        resolve(rows);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    const params = new URLSearchParams({
      sheet: sheetName,
      range,
      headers: "1",
      tqx: `out:json;responseHandler:${callbackName}`
    });
    const script = document.createElement("script");
    script.src = `https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/gviz/tq?${params.toString()}`;
    script.onerror = () => {
      cleanup();
      reject(new Error(`Could not connect to ${sheetName}`));
    };
    document.head.appendChild(script);
  });
}


/*
 * SPONSORS can be pasted directly from SPONSORS_TEMPLATE.csv, so its header
 * row may be at row 1 rather than row 4 like the original workbook tabs.
 * Read the whole A:O area and locate the header row by column names.
 */
function sponsorRowsLookValid(rows) {
  return Array.isArray(rows) && rows.some(row =>
    Object.prototype.hasOwnProperty.call(row, "Name") &&
    Object.prototype.hasOwnProperty.call(row, "Tier")
  );
}

/*
 * Load SPONSORS using the same Google Visualization loader that already
 * powers the rest of the conference app. The sponsor template has headers
 * on row 1, but this also falls back to row 4 in case it was inserted using
 * the original workbook layout.
 */
async function loadSponsorsSheet() {
  const attempts = ["A1:O", "A4:O"];
  let lastError = null;

  for (const range of attempts) {
    try {
      const rows = await loadSheet("SPONSORS", range);
      if (sponsorRowsLookValid(rows)) {
        return rows;
      }
      lastError = new Error(`SPONSORS was readable at ${range}, but Name/Tier headings were not detected.`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Could not read the SPONSORS sheet.");
}

function published(row) {
  const status = String(row.Status || "Published").trim().toLowerCase();
  return !status || status === "published";
}

function buildDatabase(raw) {
  DB.sessions = raw.SESSIONS.filter(published);
  DB.presentations = raw.PRESENTATIONS.filter(published);
  DB.abstracts = raw.ABSTRACTS.filter(published);
  DB.speakers = raw.SPEAKERS;
  DB.venues = raw.VENUES;
  DB.announcements = raw.ANNOUNCEMENTS;
  DB.sponsors = raw.SPONSORS || [];
  DB.settings = Object.fromEntries(raw.SETTINGS.filter(r => r.Setting).map(r => [String(r.Setting).trim(), r.Value]));

  DB.settings.StartDate = normaliseDate(DB.settings.StartDate);
  DB.settings.EndDate = normaliseDate(DB.settings.EndDate);

  const venues = Object.fromEntries(DB.venues.map(v => [v.VenueID, v]));
  const sessions = Object.fromEntries(DB.sessions.map(s => [s.SessionID, s]));
  const abstracts = Object.fromEntries(DB.abstracts.map(a => [a.AbstractID, a]));
  const speakers = Object.fromEntries(DB.speakers.map(s => [s.SpeakerID, s]));

  const presentationsBySession = {};
  DB.presentations.forEach(p => {
    if (!p.SessionID) return;
    if (!presentationsBySession[p.SessionID]) presentationsBySession[p.SessionID] = [];
    const abs = abstracts[p.AbstractID] || {};
    const sp = speakers[p.SpeakerID] || {};
    presentationsBySession[p.SessionID].push({
      id: p.PresentationID,
      time: normaliseTime(p.StartTime),
      end: normaliseTime(p.EndTime),
      type: p.PresentationType,
      title: p.Title || abs.Title || "Untitled presentation",
      speakerId: p.SpeakerID,
      speaker: p.SpeakerDisplay || sp.DisplayName || "",
      authors: p.AuthorsDisplay || abs.Authors || "",
      affiliations: p.AffiliationsDisplay || abs.Affiliations || "",
      abstractId: p.AbstractID,
      abstract: abs.AbstractText || "",
      keywords: abs.Keywords || "",
      sequence: Number(p.Sequence || 999)
    });
  });
  Object.values(presentationsBySession).forEach(list => list.sort((a,b) => a.sequence - b.sequence || a.time.localeCompare(b.time)));

  DB.program = raw.PROGRAM.filter(published).filter(r => r.ProgramID).map(row => {
    const session = sessions[row.SessionID] || {};
    const venue = venues[row.VenueID] || {};
    return {
      id: row.ProgramID,
      date: normaliseDate(row.Date),
      start: normaliseTime(row.StartTime),
      end: normaliseTime(row.EndTime),
      type: row.Type || "Other",
      title: row.Title || session.SessionTitle || "Untitled event",
      venueId: row.VenueID,
      room: venue.VenueName || row.VenueID || "Venue TBC",
      sessionId: row.SessionID,
      speaker: row.SpeakerDisplay || "",
      description: row.Description || session.Description || "",
      chair: session.Chair || "",
      coChair: session.CoChair || "",
      track: session.Track || "",
      favouriteAllowed: String(row.FavouriteAllowed || "Yes").toLowerCase() !== "no",
      showOnHome: String(row.ShowOnHome || "Yes").toLowerCase() !== "no",
      sortOrder: Number(row.SortOrder || 999),
      presentations: row.SessionID ? (presentationsBySession[row.SessionID] || []) : []
    };
  }).sort((a,b) => (a.date+a.start).localeCompare(b.date+b.start) || a.sortOrder - b.sortOrder);

  DB.loaded = true;
}

async function loadConferenceData() {
  showLoadingIndicator();
  try {
    const entries = Object.entries(CONFIG.sheets);
    const results = await Promise.all(entries.map(([name, range]) => loadSheet(name, range)));
    const raw = Object.fromEntries(entries.map(([name], i) => [name, results[i]]));

    // Sponsor sheet uses automatic header detection so it works whether the
    // SPONSORS template was pasted starting at row 1 or placed lower down.
    DB.sponsorLoadError = "";
    try {
      raw.SPONSORS = await loadSponsorsSheet();
      console.info(`Loaded ${raw.SPONSORS.length} sponsor row(s).`);
    } catch (sponsorError) {
      console.error("SPONSORS load error:", sponsorError);
      raw.SPONSORS = [];
      DB.sponsorLoadError = sponsorError.message || "Please check the SPONSORS tab headings.";
    }

    buildDatabase(raw);
    applySettings();
    initialiseProgramDay();
    renderAll();
    hideDataStatus();
  } catch (error) {
    console.error(error);
    renderLoadError(error);
    showDataError();
  }
}

function applySettings() {
  const conferenceName = DB.settings.ConferenceName || "ALM7 & 5th iLS Conference";
  const location = DB.settings.Location || "Perth, Western Australia";
  const dateLabel = dateRangeLabel(DB.settings.StartDate, DB.settings.EndDate);
  document.title = conferenceName;
  document.querySelector(".hero .eyebrow").textContent = conferenceName;
  document.querySelector(".hero h1").textContent = location;
  document.querySelector(".hero-date").textContent = dateLabel;
}

function initialiseProgramDay() {
  const { date } = getPerthNowParts();
  const dates = getConferenceDates();
  selectedProgramDate = dates.includes(date) ? date : (DB.settings.StartDate || dates[0] || "2026-10-18");
  renderDayTabs();
}

function getConferenceDates() {
  const start = DB.settings.StartDate;
  const end = DB.settings.EndDate;
  if (start && end) {
    const out = [];
    const current = new Date(`${start}T12:00:00`);
    const finish = new Date(`${end}T12:00:00`);
    while (current <= finish && out.length < 14) {
      out.push(`${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,"0")}-${String(current.getDate()).padStart(2,"0")}`);
      current.setDate(current.getDate() + 1);
    }
    return out;
  }
  return [...new Set(DB.program.map(x => x.date))].filter(Boolean).sort();
}

function renderDayTabs() {
  const holder = document.querySelector(".day-tabs");
  const dates = getConferenceDates();
  holder.innerHTML = dates.map(date => {
    const d = new Date(`${date}T12:00:00`);
    return `<button class="day-tab ${date === selectedProgramDate ? "active" : ""}" data-date="${date}">
      ${d.toLocaleDateString("en-AU", {weekday:"short"})} <strong>${d.getDate()}</strong>
    </button>`;
  }).join("");
  holder.style.gridTemplateColumns = `repeat(${Math.max(1, dates.length)}, 1fr)`;
  holder.querySelectorAll(".day-tab").forEach(btn => btn.addEventListener("click", () => {
    selectedProgramDate = btn.dataset.date;
    renderDayTabs();
    renderProgram();
  }));
}

function getFavourites() {
  try { return JSON.parse(localStorage.getItem("alm7-favourites") || "[]"); }
  catch { return []; }
}

function updateFavouriteCount() {
  document.querySelector("#favourite-count").textContent = getFavourites().length;
}

function toggleFavourite(id) {
  const favourites = getFavourites();
  const next = favourites.includes(id) ? favourites.filter(x => x !== id) : [...favourites, id];
  localStorage.setItem("alm7-favourites", JSON.stringify(next));
  updateFavouriteCount();
  renderProgram();
  renderMyProgram();
  renderAbstracts();
  renderSpeakers();
}

function renderHome() {
  const happening = document.querySelector("#happening-now");
  const upNext = document.querySelector("#up-next");
  const todayList = document.querySelector("#today-program");
  const todayHeading = document.querySelector("#today-heading");
  if (!DB.loaded) return;

  const now = getPerthNowParts();
  const start = DB.settings.StartDate || DB.program[0]?.date;
  const end = DB.settings.EndDate || DB.program.at(-1)?.date;
  const todays = DB.program.filter(x => x.date === now.date && x.showOnHome);

  if (start && now.date < start) {
    const days = daysBetween(now.date, start);
    happening.innerHTML = `<div class="event-time">Conference countdown</div><div class="event-title">${days} day${days === 1 ? "" : "s"} to go</div><div class="event-meta">We’ll see you in ${escapeHTML(DB.settings.Location || "Perth")}</div>`;
    const first = DB.program.find(x => x.showOnHome);
    upNext.innerHTML = first ? eventCardHTML(first) : `<div class="event-title">Program coming soon</div>`;
    const firstDay = DB.program.filter(x => x.date === start && x.showOnHome);
    todayHeading.textContent = `${formatDate(start)} — Preview`;
    todayList.innerHTML = timelineHTML(firstDay.slice(0, 6), "No published items yet for opening day.");
  } else if (end && now.date > end) {
    happening.innerHTML = `<div class="event-time">Conference complete</div><div class="event-title">Thank you for joining us</div><div class="event-meta">ALM7 & 5th iLS Conference</div>`;
    upNext.innerHTML = `<div class="event-title">Program archive</div><div class="event-meta">Browse the full program and abstracts.</div>`;
    todayHeading.textContent = "Conference program";
    todayList.innerHTML = timelineHTML(DB.program.slice(0, 6), "");
  } else {
    const current = todays.filter(x => parseMinutes(x.start) <= now.minutes && now.minutes < parseMinutes(x.end));
    const next = todays.find(x => parseMinutes(x.start) > now.minutes);
    happening.innerHTML = current.length ? current.map(eventCardHTML).join("<hr class='mini-rule'>") : `<div class="event-title">Nothing scheduled right now</div><div class="event-meta">Check the full program for what’s coming up.</div>`;
    upNext.innerHTML = next ? eventCardHTML(next) : `<div class="event-title">That’s all for today</div>`;
    todayHeading.textContent = formatDate(now.date);
    todayList.innerHTML = timelineHTML(todays, "No published program items for today.");
  }

  renderAnnouncements();
}

function eventCardHTML(item) {
  return `<div class="event-time">${escapeHTML(formatTime(item.start))}–${escapeHTML(formatTime(item.end))}</div>
    <div class="event-title">${escapeHTML(item.title)}</div>
    <div class="event-meta">${escapeHTML(item.room)}${item.speaker ? " • " + escapeHTML(item.speaker) : ""}</div>`;
}

function timelineHTML(items, emptyMessage) {
  if (!items.length) return `<div class="empty-program">${escapeHTML(emptyMessage)}</div>`;
  return items.map(item => `<div class="timeline-item">
      <div class="timeline-time">${escapeHTML(formatTime(item.start))}</div>
      <div><div class="timeline-title">${escapeHTML(item.title)}</div><div class="timeline-meta">${escapeHTML(formatTime(item.start))}–${escapeHTML(formatTime(item.end))} • ${escapeHTML(item.room)}${item.presentations.length ? " • " + item.presentations.length + " presentations" : ""}</div></div>
      <div class="timeline-type">${escapeHTML(item.type)}</div>
    </div>`).join("");
}

function renderAnnouncements() {
  const holder = document.querySelector("#announcement-area");
  const now = getPerthNowParts().date;
  const active = DB.announcements.filter(a => {
    if (String(a.Active || "Yes").toLowerCase() === "no") return false;
    const from = normaliseDate(a.DisplayFrom);
    const until = normaliseDate(a.DisplayUntil);
    return (!from || now >= from) && (!until || now <= until);
  });
  holder.innerHTML = active.map(a => `<div class="announcement ${String(a.Priority).toLowerCase() === "urgent" ? "urgent" : ""}">
    <div class="announcement-title">📢 ${escapeHTML(a.Title || "Conference update")}</div>
    <div class="announcement-text">${escapeHTML(a.Message || "")}</div>
  </div>`).join("");
}

function availableProgramTypes() {
  const types = [...new Set(DB.program.map(x => x.type).filter(Boolean))];
  return FILTER_ORDER.filter(x => x === "All" || types.includes(x)).concat(types.filter(x => !FILTER_ORDER.includes(x)));
}

function renderProgramFilters() {
  const holder = document.querySelector("#program-filters");
  holder.innerHTML = availableProgramTypes().map(type => `<button class="filter-chip ${selectedProgramFilter === type ? "active" : ""}" data-filter="${escapeHTML(type)}">${escapeHTML(type)}</button>`).join("");
  holder.querySelectorAll(".filter-chip").forEach(btn => btn.addEventListener("click", () => {
    selectedProgramFilter = btn.dataset.filter;
    renderProgram();
  }));
}

function renderProgram() {
  if (!DB.loaded) return;
  renderProgramFilters();
  const q = (document.querySelector("#program-search")?.value || "").trim().toLowerCase();
  let items = DB.program.filter(item => item.date === selectedProgramDate);
  if (selectedProgramFilter !== "All") items = items.filter(item => item.type === selectedProgramFilter);
  if (q) items = items.filter(item => [item.title,item.type,item.room,item.description,item.chair,item.speaker,item.track,...item.presentations.map(p => `${p.title} ${p.authors} ${p.abstract} ${p.keywords}`)].join(" ").toLowerCase().includes(q));

  const list = document.querySelector("#program-list");
  document.querySelector("#program-summary-text").textContent = `${formatDate(selectedProgramDate)} • ${items.length} item${items.length === 1 ? "" : "s"} shown`;
  if (!items.length) {
    list.innerHTML = `<div class="empty-program">No published program items match this day, search or filter.</div>`;
    return;
  }
  const favourites = getFavourites();
  list.innerHTML = items.map(item => {
    const rowClass = ["Break","Lunch"].includes(item.type) ? "break-row" : item.type === "Social" ? "social-row" : ["Plenary","Keynote"].includes(item.type) ? "plenary-row" : item.type === "Workshop" ? "workshop-row" : "";
    const hasDetails = item.presentations.length || item.description || item.speaker || item.chair;
    const saved = favourites.includes(item.id);
    return `<article class="program-row ${rowClass}">
      <div class="program-time">${escapeHTML(formatTime(item.start))}<br>– ${escapeHTML(formatTime(item.end))}</div>
      <div class="program-line"></div>
      <div class="program-main">
        ${hasDetails ? `<button class="program-title-button" onclick="openSessionModal('${escapeHTML(item.id)}')">${escapeHTML(item.title)}</button>` : `<div class="program-title-button">${escapeHTML(item.title)}</div>`}
        <div class="program-meta">📍 ${escapeHTML(item.room)}${item.speaker ? " • " + escapeHTML(item.speaker) : ""}${item.chair ? " • Chair: " + escapeHTML(item.chair) : ""}</div>
        ${item.description ? `<div class="program-description">${escapeHTML(item.description)}</div>` : ""}
        <div class="program-badges"><span class="program-badge">${escapeHTML(item.type)}</span>${item.presentations.length ? `<span class="program-badge">${item.presentations.length} presentation${item.presentations.length === 1 ? "" : "s"}</span>` : ""}</div>
      </div>
      ${item.favouriteAllowed ? `<button class="program-favourite ${saved ? "saved" : ""}" onclick="toggleFavourite('${escapeHTML(item.id)}')" aria-label="${saved ? "Remove from" : "Add to"} My Program">${saved ? "★" : "☆"}</button>` : `<span></span>`}
    </article>`;
  }).join("");
}

function openSessionModal(id) {
  const item = DB.program.find(x => x.id === id);
  if (!item) return;
  const modal = document.querySelector("#session-modal");
  const content = document.querySelector("#session-modal-content");
  content.innerHTML = `<div class="modal-eyebrow">${escapeHTML(item.type)}</div>
    <h2 id="session-modal-title" class="modal-title">${escapeHTML(item.title)}</h2>
    <div class="modal-meta">${escapeHTML(formatTime(item.start))}–${escapeHTML(formatTime(item.end))} &nbsp; • &nbsp; 📍 ${escapeHTML(item.room)}${item.speaker ? " &nbsp; • &nbsp; " + escapeHTML(item.speaker) : ""}</div>
    ${item.description ? `<p class="modal-intro">${escapeHTML(item.description)}</p>` : ""}
    ${item.chair ? `<p class="modal-meta">Chair: ${escapeHTML(item.chair)}${item.coChair ? " • Co-chair: " + escapeHTML(item.coChair) : ""}</p>` : ""}
    ${item.presentations.length ? `<div class="presentation-list">${item.presentations.map((p, i) => `<div class="presentation">
      <div class="presentation-head">
        <div class="presentation-time">${escapeHTML(formatTime(p.time))}</div>
        <div><div class="presentation-title">${escapeHTML(p.title)}</div><div class="presentation-authors">${escapeHTML(p.authors || p.speaker)}${p.affiliations ? `<br>${escapeHTML(p.affiliations)}` : ""}</div></div>
        ${p.abstract ? `<button class="abstract-toggle" onclick="toggleAbstract(${i})">Abstract ▾</button>` : ""}
      </div>
      ${p.abstract ? `<div id="abstract-${i}" class="abstract-text">${escapeHTML(p.abstract)}</div>` : ""}
    </div>`).join("")}</div>` : ""}`;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function toggleAbstract(index) {
  document.querySelector(`#abstract-${index}`)?.classList.toggle("open");
}

function closeSessionModal() {
  const modal = document.querySelector("#session-modal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function renderMyProgram() {
  if (!DB.loaded) return;
  const ids = getFavourites();
  const box = document.querySelector("#my-program-list");
  const items = DB.program.filter(x => ids.includes(x.id)).sort((a,b) => (a.date+a.start).localeCompare(b.date+b.start));
  if (!items.length) {
    box.innerHTML = "You haven't saved any sessions yet.";
    return;
  }
  box.innerHTML = items.map(item => `<div class="search-result my-program-row">
    <div><div class="search-result-type">${escapeHTML(formatDate(item.date))} • ${escapeHTML(item.type)}</div><div class="search-result-title">${escapeHTML(item.title)}</div><div class="search-result-meta">${escapeHTML(formatTime(item.start))}–${escapeHTML(formatTime(item.end))} • ${escapeHTML(item.room)}</div></div>
    <button class="program-favourite saved" onclick="toggleFavourite('${escapeHTML(item.id)}')" aria-label="Remove from My Program">★</button>
  </div>`).join("");
}

function buildSearchItems() {
  const items = [];
  DB.program.forEach(p => items.push({type:p.type, title:p.title, meta:`${formatDate(p.date, {short:true})} • ${formatTime(p.start)} • ${p.room}`, haystack:`${p.title} ${p.description} ${p.type} ${p.room} ${p.speaker} ${p.chair}`}));
  DB.presentations.forEach(p => {
    const abs = DB.abstracts.find(a => a.AbstractID === p.AbstractID) || {};
    items.push({type:p.PresentationType || "Presentation", title:p.Title || abs.Title, meta:`${p.SpeakerDisplay || p.AuthorsDisplay || ""}`, haystack:`${p.Title} ${p.SpeakerDisplay} ${p.AuthorsDisplay} ${p.AffiliationsDisplay} ${abs.AbstractText || ""} ${abs.Keywords || ""}`});
  });
  DB.speakers.filter(s => s.DisplayName).forEach(s => items.push({type:"Speaker", title:s.DisplayName, meta:s.Affiliation || "", haystack:`${s.DisplayName} ${s.Affiliation} ${s.Bio || ""}`}));
  return items;
}

function renderSearch() {
  const input = document.querySelector("#global-search");
  const box = document.querySelector("#search-results");
  const q = input.value.trim().toLowerCase();
  if (!q) { box.innerHTML = "Start typing to search."; return; }
  const matches = buildSearchItems().filter(item => `${item.title} ${item.meta} ${item.haystack}`.toLowerCase().includes(q)).slice(0, 40);
  box.innerHTML = matches.length ? matches.map(item => `<div class="search-result"><div class="search-result-type">${escapeHTML(item.type)}</div><div class="search-result-title">${escapeHTML(item.title)}</div><div class="search-result-meta">${escapeHTML(item.meta)}</div></div>`).join("") : "No results found.";
}

function renderLoadError(error) {
  document.querySelector("#program-list").innerHTML = `<div class="empty-program"><strong>Live program unavailable.</strong><br>${escapeHTML(error.message)}<br><br>Refresh the page after checking the Google Sheet publishing settings.</div>`;
  document.querySelector("#happening-now").innerHTML = `<div class="event-title">Program connection unavailable</div>`;
  document.querySelector("#up-next").innerHTML = `<div class="event-meta">Please refresh to try again.</div>`;
  document.querySelector("#today-program").innerHTML = "";
}



function speakerInitials(name) {
  return String(name || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("") || "?";
}

function speakerPhotoHTML(speaker, className = "") {
  const url = String(speaker.PhotoURL || "").trim();
  if (url) {
    return `<img src="${escapeHTML(url)}" alt="${escapeHTML(speaker.DisplayName || "Speaker")}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;speaker-initials&quot;>${escapeHTML(speakerInitials(speaker.DisplayName))}</div>'">`;
  }
  return `<div class="speaker-initials">${escapeHTML(speakerInitials(speaker.DisplayName))}</div>`;
}

function getPresentationContext(presentation) {
  const session = DB.sessions.find(s => s.SessionID === presentation.SessionID) || {};
  const program = DB.program.find(item => item.sessionId === presentation.SessionID) || {};
  return { session, program };
}

function getAbstractPresentation(abstractId) {
  return DB.presentations.find(p => p.AbstractID === abstractId) || null;
}

function renderAbstracts() {
  const list = document.querySelector("#abstract-list");
  const count = document.querySelector("#abstract-count");
  const search = document.querySelector("#abstract-search");
  const topicSelect = document.querySelector("#abstract-topic-filter");
  if (!list || !count || !topicSelect) return;

  const topics = [...new Set(DB.abstracts.map(a => String(a.Topic || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const currentTopic = topicSelect.value || "All";
  topicSelect.innerHTML = `<option value="All">All topics</option>${topics.map(topic => `<option value="${escapeHTML(topic)}">${escapeHTML(topic)}</option>`).join("")}`;
  topicSelect.value = topics.includes(currentTopic) ? currentTopic : "All";

  const query = String(search?.value || "").trim().toLowerCase();
  const selectedTopic = topicSelect.value || "All";

  const abstracts = DB.abstracts
    .filter(a => a.AbstractID || a.Title)
    .filter(a => {
      if (selectedTopic !== "All" && String(a.Topic || "") !== selectedTopic) return false;
      if (!query) return true;
      const haystack = [
        a.Title, a.Authors, a.Affiliations, a.AbstractText, a.Keywords,
        a.Topic, a.CorrespondingAuthor, a.SubmissionNumber
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => String(a.Title || "").localeCompare(String(b.Title || "")));

  count.textContent = `${abstracts.length} abstract${abstracts.length === 1 ? "" : "s"}`;

  if (!abstracts.length) {
    list.innerHTML = `<div class="directory-empty">No abstracts match your search.</div>`;
    return;
  }

  list.innerHTML = abstracts.map(abs => {
    const presentation = getAbstractPresentation(abs.AbstractID);
    const context = presentation ? getPresentationContext(presentation) : {};
    const presentationType = presentation?.PresentationType || "";
    const topic = abs.Topic || "";
    const preview = String(abs.AbstractText || "").replace(/\s+/g, " ").trim();
    const shortPreview = preview.length > 240 ? `${preview.slice(0, 237)}…` : preview;
    const sessionTitle = context.session?.SessionTitle || "";
    return `<article class="abstract-card">
      <div class="abstract-card-main">
        <div class="abstract-badges">
          ${presentationType ? `<span class="abstract-badge">${escapeHTML(presentationType)}</span>` : ""}
          ${topic ? `<span class="abstract-badge topic">${escapeHTML(topic)}</span>` : ""}
        </div>
        <h3>${escapeHTML(abs.Title || presentation?.Title || "Untitled abstract")}</h3>
        ${abs.Authors ? `<div class="abstract-authors">${escapeHTML(abs.Authors)}</div>` : ""}
        ${abs.Affiliations ? `<div class="abstract-affiliations">${escapeHTML(abs.Affiliations)}</div>` : ""}
        ${sessionTitle ? `<div class="abstract-affiliations"><strong>Session:</strong> ${escapeHTML(sessionTitle)}</div>` : ""}
        ${shortPreview ? `<div class="abstract-preview">${escapeHTML(shortPreview)}</div>` : ""}
        ${abs.Keywords ? `<div class="abstract-keywords"><strong>Keywords:</strong> ${escapeHTML(abs.Keywords)}</div>` : ""}
      </div>
      <button class="abstract-open" type="button" data-open-abstract="${escapeHTML(abs.AbstractID)}">View abstract</button>
    </article>`;
  }).join("");
}

function openAbstract(abstractId) {
  const abs = DB.abstracts.find(a => String(a.AbstractID) === String(abstractId));
  const modal = document.querySelector("#abstract-modal");
  const content = document.querySelector("#abstract-modal-content");
  if (!abs || !modal || !content) return;

  const presentation = getAbstractPresentation(abs.AbstractID);
  const { session, program } = presentation ? getPresentationContext(presentation) : { session: {}, program: {} };

  const scheduleBits = [];
  if (program?.date) scheduleBits.push(formatDate(program.date));
  if (presentation?.StartTime) {
    const start = normaliseTime(presentation.StartTime);
    const end = normaliseTime(presentation.EndTime);
    scheduleBits.push(`${formatTime(start)}${end ? `–${formatTime(end)}` : ""}`);
  }
  if (program?.room) scheduleBits.push(program.room);

  content.innerHTML = `
    <span class="eyebrow">${escapeHTML(presentation?.PresentationType || abs.Topic || "Conference abstract")}</span>
    <h2 id="abstract-modal-title">${escapeHTML(abs.Title || presentation?.Title || "Untitled abstract")}</h2>
    ${abs.Authors ? `<div class="abstract-modal-authors">${escapeHTML(abs.Authors)}</div>` : ""}
    ${abs.Affiliations ? `<div class="abstract-modal-affiliations">${escapeHTML(abs.Affiliations)}</div>` : ""}
    ${session?.SessionTitle ? `<div class="abstract-modal-meta"><strong>Session:</strong> ${escapeHTML(session.SessionTitle)}</div>` : ""}
    ${scheduleBits.length ? `<div class="abstract-modal-meta">${escapeHTML(scheduleBits.join(" • "))}</div>` : ""}
    ${abs.AbstractText ? `<div class="abstract-modal-body">${escapeHTML(abs.AbstractText)}</div>` : `<div class="abstract-modal-body">Abstract text is not yet available.</div>`}
    ${abs.Keywords ? `<div class="abstract-modal-keywords"><strong>Keywords:</strong> ${escapeHTML(abs.Keywords)}</div>` : ""}
  `;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeDirectoryModal(which) {
  const modal = document.querySelector(which === "speaker" ? "#speaker-modal" : "#abstract-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".directory-modal.open, .facilitator-modal.open, .modal.open")) {
    document.body.style.overflow = "";
  }
}

function getSpeakerPresentations(speaker) {
  const id = String(speaker.SpeakerID || "");
  const displayName = String(speaker.DisplayName || "").trim().toLowerCase();
  return DB.presentations.filter(p => {
    if (id && String(p.SpeakerID || "") === id) return true;
    return displayName && String(p.SpeakerDisplay || "").trim().toLowerCase() === displayName;
  });
}

function renderSpeakers() {
  const grid = document.querySelector("#speaker-grid");
  const count = document.querySelector("#speaker-count");
  const search = document.querySelector("#speaker-search");
  if (!grid || !count) return;

  const query = String(search?.value || "").trim().toLowerCase();

  const speakers = DB.speakers
    .filter(s => String(s.DisplayName || "").trim())
    .filter(s => {
      if (!query) return true;
      return [s.DisplayName, s.Affiliation, s.Country, s.Bio].join(" ").toLowerCase().includes(query);
    })
    .sort((a, b) => {
      const featuredA = /^(yes|true|1)$/i.test(String(a.Featured || "")) ? 0 : 1;
      const featuredB = /^(yes|true|1)$/i.test(String(b.Featured || "")) ? 0 : 1;
      return featuredA - featuredB || String(a.LastName || a.DisplayName).localeCompare(String(b.LastName || b.DisplayName));
    });

  count.textContent = `${speakers.length} speaker${speakers.length === 1 ? "" : "s"}`;

  if (!speakers.length) {
    grid.innerHTML = `<div class="directory-empty">No speakers match your search.</div>`;
    return;
  }

  grid.innerHTML = speakers.map(s => {
    const talks = getSpeakerPresentations(s);
    return `<button class="speaker-card-live" type="button" data-open-speaker="${escapeHTML(s.SpeakerID)}">
      <div class="speaker-photo-wrap">${speakerPhotoHTML(s)}</div>
      <div class="speaker-card-copy">
        <h3>${escapeHTML(s.DisplayName)}</h3>
        <div class="speaker-affiliation">${escapeHTML(s.Affiliation || "")}</div>
        ${s.Country ? `<div class="speaker-country">${escapeHTML(s.Country)}</div>` : ""}
        ${talks.length ? `<span class="speaker-talk-count">${talks.length} presentation${talks.length === 1 ? "" : "s"}</span>` : ""}
      </div>
    </button>`;
  }).join("");
}

function openSpeaker(speakerId) {
  const speaker = DB.speakers.find(s => String(s.SpeakerID) === String(speakerId));
  const modal = document.querySelector("#speaker-modal");
  const content = document.querySelector("#speaker-modal-content");
  if (!speaker || !modal || !content) return;

  const talks = getSpeakerPresentations(speaker);
  const talkHTML = talks.length ? talks.map(p => {
    const { session, program } = getPresentationContext(p);
    const abs = DB.abstracts.find(a => a.AbstractID === p.AbstractID) || {};
    const time = normaliseTime(p.StartTime);
    const meta = [
      program.date ? formatDate(program.date) : "",
      time ? formatTime(time) : "",
      session.SessionTitle || "",
      program.room || ""
    ].filter(Boolean).join(" • ");
    return `<div class="speaker-presentation-row">
      <strong>${escapeHTML(p.Title || abs.Title || "Presentation")}</strong>
      ${meta ? `<div class="speaker-presentation-meta">${escapeHTML(meta)}</div>` : ""}
      ${p.AbstractID ? `<button type="button" data-speaker-open-abstract="${escapeHTML(p.AbstractID)}">View abstract →</button>` : ""}
    </div>`;
  }).join("") : `<div class="directory-empty">No linked presentations are currently published.</div>`;

  content.innerHTML = `
    <div class="speaker-modal-profile">
      <div class="speaker-modal-photo">${speakerPhotoHTML(speaker)}</div>
      <div>
        <span class="eyebrow">Speaker profile</span>
        <h2 id="speaker-modal-name">${escapeHTML(speaker.DisplayName)}</h2>
        ${speaker.Affiliation ? `<p class="speaker-modal-role">${escapeHTML(speaker.Affiliation)}</p>` : ""}
        ${speaker.Country ? `<div class="speaker-country">${escapeHTML(speaker.Country)}</div>` : ""}
      </div>
    </div>
    ${speaker.Bio ? `<div class="speaker-modal-bio">${escapeHTML(speaker.Bio)}</div>` : ""}
    <div class="speaker-presentations">
      <h3>Conference presentations</h3>
      ${talkHTML}
    </div>
  `;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}


const SPONSOR_TIER_ORDER = ["Platinum", "Gold", "Silver", "Bronze", "Award"];

function sponsorTier(value) {
  const raw = String(value || "").trim();
  const match = SPONSOR_TIER_ORDER.find(t => t.toLowerCase() === raw.toLowerCase());
  return match || raw || "Other";
}

function sponsorLogoHTML(sponsor) {
  const url = String(sponsor.LogoURL || "").trim();
  if (url) {
    return `<img src="${escapeHTML(url)}" alt="${escapeHTML(sponsor.Name || "Sponsor")} logo" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'sponsor-logo-fallback',textContent:${JSON.stringify(String(sponsor.Name || "Sponsor"))}}))">`;
  }
  return `<div class="sponsor-logo-fallback">${escapeHTML(sponsor.Name || "Sponsor")}</div>`;
}

function getSponsorScience(sponsor) {
  const presentation = sponsor.PresentationID
    ? DB.presentations.find(p => String(p.PresentationID) === String(sponsor.PresentationID))
    : null;
  const abstract = sponsor.AbstractID
    ? DB.abstracts.find(a => String(a.AbstractID) === String(sponsor.AbstractID))
    : (presentation?.AbstractID ? DB.abstracts.find(a => a.AbstractID === presentation.AbstractID) : null);

  const linkedProgram = presentation?.SessionID
    ? DB.program.find(item => item.sessionId === presentation.SessionID)
    : null;

  return {
    title: sponsor.PosterTitle || presentation?.Title || abstract?.Title || "",
    abstractText: sponsor.PosterAbstract || abstract?.AbstractText || "",
    abstractId: abstract?.AbstractID || sponsor.AbstractID || "",
    time: sponsor.PosterTime || (presentation?.StartTime ? formatTime(normaliseTime(presentation.StartTime)) : ""),
    location: sponsor.PosterLocation || linkedProgram?.room || "",
    authors: abstract?.Authors || presentation?.AuthorsDisplay || "",
    affiliations: abstract?.Affiliations || presentation?.AffiliationsDisplay || ""
  };
}

function renderSponsors() {
  const holder = document.querySelector("#sponsors-content");
  if (!holder) return;

  if (DB.sponsorLoadError) {
    holder.innerHTML = `<div class="sponsor-empty">
      <strong>Unable to read the SPONSORS sheet</strong>
      ${escapeHTML(DB.sponsorLoadError)}
    </div>`;
    return;
  }

  const sponsors = DB.sponsors
    .filter(s => {
      const status = String(s.Status || "").trim().toLowerCase();
      const hiddenStatuses = ["hidden", "hide", "disabled", "inactive", "no"];
      return !hiddenStatuses.includes(status) && String(s.Name || "").trim();
    })
    .sort((a,b) => {
      const ta = SPONSOR_TIER_ORDER.indexOf(sponsorTier(a.Tier));
      const tb = SPONSOR_TIER_ORDER.indexOf(sponsorTier(b.Tier));
      const oa = Number(a.DisplayOrder || 999);
      const ob = Number(b.DisplayOrder || 999);
      return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb) || oa - ob || String(a.Name).localeCompare(String(b.Name));
    });

  if (!sponsors.length) {
    holder.innerHTML = `<div class="sponsor-empty">
      <strong>No sponsor rows were found</strong>
      The SPONSORS tab was reached successfully, but no rows with a value in the Name column were returned.
    </div>`;
    return;
  }

  const tiers = [...new Set(sponsors.map(s => sponsorTier(s.Tier)))];
  holder.innerHTML = tiers.map(tier => {
    const rows = sponsors.filter(s => sponsorTier(s.Tier) === tier);
    const tierClass = tier.toLowerCase().replace(/\s+/g,"-");
    return `<section class="sponsor-tier-section">
      <div class="sponsor-tier-heading">
        <span class="sponsor-tier-chip ${escapeHTML(tierClass)}">${escapeHTML(tier)}</span>
        <h2>${escapeHTML(tier)} Sponsor${rows.length === 1 ? "" : "s"}</h2>
      </div>
      <div class="sponsor-grid">
        ${rows.map(sponsor => renderSponsorCard(sponsor, tier)).join("")}
      </div>
    </section>`;
  }).join("");
}

function renderSponsorCard(sponsor, tier) {
  const science = getSponsorScience(sponsor);
  const lower = tier.toLowerCase();
  const isPlatinum = lower === "platinum";
  const isExhibitor = lower === "gold" || lower === "silver";

  let scienceHTML = "";
  if ((isPlatinum || isExhibitor) && science.title) {
    scienceHTML = `<div class="sponsor-science">
      <strong>${isPlatinum ? "Sponsored presentation" : "Sponsor poster"}: ${escapeHTML(science.title)}</strong>
      ${science.time || science.location ? `<small>${escapeHTML([science.time, science.location || (isExhibitor ? "Silver Room" : "")].filter(Boolean).join(" • "))}</small>` : ""}
    </div>`;
  }

  const abstractAvailable = Boolean(science.abstractText || science.abstractId);
  const website = String(sponsor.Website || "").trim();

  return `<article class="sponsor-card ${escapeHTML(lower)}">
    <div class="sponsor-logo-wrap">${sponsorLogoHTML(sponsor)}</div>
    <div class="sponsor-copy">
      <h3>${escapeHTML(sponsor.Name)}</h3>
      ${sponsor.Description ? `<p>${escapeHTML(sponsor.Description)}</p>` : ""}
      ${isExhibitor ? `<div class="silver-room-note">⌖ Located in the Silver Room</div>` : ""}
      ${scienceHTML}
      <div class="sponsor-actions">
        ${website ? `<a class="sponsor-link" href="${escapeHTML(website)}" target="_blank" rel="noopener">Visit website ↗</a>` : ""}
        ${abstractAvailable ? `<button class="sponsor-abstract-button" type="button" data-sponsor-abstract="${escapeHTML(sponsor.SponsorID || sponsor.Name)}">${isPlatinum ? "View talk abstract" : "View poster abstract"}</button>` : ""}
      </div>
    </div>
  </article>`;
}

function openSponsorAbstract(sponsorId) {
  const sponsor = DB.sponsors.find(s => String(s.SponsorID || s.Name) === String(sponsorId));
  const modal = document.querySelector("#sponsor-abstract-modal");
  const content = document.querySelector("#sponsor-abstract-content");
  if (!sponsor || !modal || !content) return;

  const tier = sponsorTier(sponsor.Tier);
  const science = getSponsorScience(sponsor);
  content.innerHTML = `
    <span class="eyebrow">${escapeHTML(tier)} sponsor</span>
    <h2 id="sponsor-abstract-title">${escapeHTML(science.title || sponsor.Name)}</h2>
    ${science.authors ? `<div class="abstract-modal-authors">${escapeHTML(science.authors)}</div>` : ""}
    ${science.affiliations ? `<div class="abstract-modal-affiliations">${escapeHTML(science.affiliations)}</div>` : ""}
    ${(science.time || science.location || ["Gold","Silver"].includes(tier)) ? `<div class="abstract-modal-meta">${escapeHTML([science.time, science.location || (["Gold","Silver"].includes(tier) ? "Silver Room" : "")].filter(Boolean).join(" • "))}</div>` : ""}
    <div class="sponsor-abstract-body">${science.abstractText ? escapeHTML(science.abstractText) : "Abstract text is not yet available."}</div>
  `;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";
}

function closeSponsorAbstract() {
  const modal = document.querySelector("#sponsor-abstract-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
}

function renderAll() {
  updateFavouriteCount();
  renderHome();
  renderProgram();
  renderMyProgram();
  renderAbstracts();
  renderSpeakers();
  renderSponsors();
}


function openMobileMenu() {
  const button = document.getElementById("mobile-menu-button");
  const menu = document.getElementById("mobile-menu");
  if (!button || !menu) return;
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
}

function closeMobileMenu() {
  const button = document.getElementById("mobile-menu-button");
  const menu = document.getElementById("mobile-menu");
  if (!button || !menu) return;
  menu.hidden = true;
  button.setAttribute("aria-expanded", "false");
}

function toggleMobileMenu() {
  const menu = document.getElementById("mobile-menu");
  if (!menu) return;
  if (menu.hidden) openMobileMenu();
  else closeMobileMenu();
}

document.getElementById("mobile-menu-button")?.addEventListener("click", event => {
  event.stopPropagation();
  toggleMobileMenu();
});

document.addEventListener("click", event => {
  const menu = document.getElementById("mobile-menu");
  const button = document.getElementById("mobile-menu-button");
  if (!menu || menu.hidden) return;
  if (!menu.contains(event.target) && !button?.contains(event.target)) closeMobileMenu();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeMobileMenu();
});

function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const target = document.querySelector(`#page-${page}`) || document.querySelector("#page-home");
  target.classList.add("active");
  document.querySelectorAll(".nav-link, .mobile-menu [data-page]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
  closeMobileMenu();
  window.scrollTo({top:0, behavior:"smooth"});
}

function goHome() { showPage("home"); }

function showVenueTab(tab) {
  document.querySelectorAll(".venue-tab").forEach(btn => {
    const active = btn.dataset.venueTab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".venue-panel").forEach(panel => panel.classList.remove("active"));
  document.querySelector(`#venue-panel-${tab}`)?.classList.add("active");
}

document.querySelectorAll("[data-page]").forEach(btn => btn.addEventListener("click", () => showPage(btn.dataset.page)));
document.querySelectorAll("[data-venue-tab]").forEach(btn => btn.addEventListener("click", () => showVenueTab(btn.dataset.venueTab)));
document.querySelector("#program-search")?.addEventListener("input", renderProgram);
document.querySelector("#clear-program-filters")?.addEventListener("click", () => {
  selectedProgramFilter = "All";
  document.querySelector("#program-search").value = "";
  renderProgram();
});
document.querySelector("#global-search")?.addEventListener("input", renderSearch);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeSessionModal(); });

updateFavouriteCount();
loadConferenceData();



document.querySelector("#abstract-search")?.addEventListener("input", renderAbstracts);
document.querySelector("#abstract-topic-filter")?.addEventListener("change", renderAbstracts);
document.querySelector("#speaker-search")?.addEventListener("input", renderSpeakers);

document.addEventListener("click", event => {
  const sponsorAbstractButton = event.target.closest("[data-sponsor-abstract]");
  if (sponsorAbstractButton) {
    event.preventDefault();
    openSponsorAbstract(sponsorAbstractButton.dataset.sponsorAbstract);
    return;
  }

  if (event.target.closest("[data-close-sponsor-modal]")) {
    event.preventDefault();
    closeSponsorAbstract();
    return;
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeSponsorAbstract();
});

document.addEventListener("click", event => {
  const abstractButton = event.target.closest("[data-open-abstract]");
  if (abstractButton) {
    openAbstract(abstractButton.dataset.openAbstract);
    return;
  }

  const speakerButton = event.target.closest("[data-open-speaker]");
  if (speakerButton) {
    openSpeaker(speakerButton.dataset.openSpeaker);
    return;
  }

  const fromSpeaker = event.target.closest("[data-speaker-open-abstract]");
  if (fromSpeaker) {
    closeDirectoryModal("speaker");
    openAbstract(fromSpeaker.dataset.speakerOpenAbstract);
    return;
  }

  const closer = event.target.closest("[data-close-directory-modal]");
  if (closer) {
    closeDirectoryModal(closer.dataset.closeDirectoryModal);
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeDirectoryModal("abstract");
    closeDirectoryModal("speaker");
  }
});



// Workshop facilitator bios are handled independently in js/workshop.js.
