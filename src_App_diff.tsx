--- src/App.tsx (原始)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SpeedDial from "./components/SpeedDial";
import MapView from "./components/MapView";
import TripHistory from "./components/TripHistory";
import { SettingsModal, SummarySheet, Toasts, type Toast } from "./components/Modals";
import GuideModal from "./components/GuideModal";
import DeployGuideModal from "./components/DeployGuideModal";
import InstallBanner from "./components/InstallBanner";
import {
  HelmetIcon, GearIcon, PlayIcon, PauseIcon, FlagIcon, BoltIcon, SignalIcon,
  BahtIcon, ClockIcon, InfoIcon, SatelliteIcon, MotoIcon, PinIcon,
} from "./components/icons";
import { useLocalStorage, useNow, useRevealObserver, useTripEngine } from "./hooks";
import { DEFAULT_FARE, elapsedMs, calcFare, type FareSettings, type TripRecord } from "./lib/trip";
import { fmtBaht, fmtClock, fmtCoord, fmtDistance, fmtKmh, fmtKm } from "./lib/geo";

const sameDay = (a: number, b: number) => {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

export default function App() {
  const [fare, setFare] = useLocalStorage<FareSettings>("winmeter:v1:fare", DEFAULT_FARE);
  const [simPref, setSimPref] = useLocalStorage<{ on: boolean }>("winmeter:v1:sim", { on: false });
  const [trips, setTrips] = useLocalStorage<TripRecord[]>("winmeter:v1:trips", []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<TripRecord | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [deployGuideOpen, setDeployGuideOpen] = useState(false);
  const [focusNonce, setFocusNonce] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [armDiscard, setArmDiscard] = useState(false);
  const armTimer = useRef<number | null>(null);

  const now = useNow(500);
  const rootRef = useRevealObserver<HTMLDivElement>();

  // Listen for deploy guide open event
  useEffect(() => {
    const handler = () => setDeployGuideOpen(true);
    window.addEventListener("open-deploy-guide", handler);
    return () => window.removeEventListener("open-deploy-guide", handler);
  }, []);

  const toast = useCallback((msg: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);

  const engine = useTripEngine({
    fare,
    simMode: simPref.on,
    onFinished: (rec) => {
      setTrips((prev) => [rec, ...prev]);
      setLastSummary(rec);
      setSelectedId(rec.id);
      setFocusNonce((n) => n + 1);
      toast("บันทึกเที่ยวลงประวัติแล้ว", "ok");
    },
    onError: (msg) => toast(msg, "err"),
    onRestored: () => toast("กู้คืนเที่ยวที่ค้างอยู่ — กดเดินทางต่อได้เลย", "info"),
  });

  const s = engine.state;
  const live = s.status === "tracking" || s.status === "paused";
  const finding = s.status === "tracking" && s.points.length === 0;

  /* ความเร็วที่แสดงผล — หน่วงเป็น 0 ถ้าสัญญาณหายเกิน 5 วิ */
  const displaySpeed =
    s.status === "tracking" && s.lastFixAt && now - s.lastFixAt > 5000 ? 0 : s.currentSpeed;

  const elapsed = elapsedMs(s, now);
  const fareNow = useMemo(() => calcFare(s.distanceM, fare), [s.distanceM, fare]);

  const selectedTrip = trips.find((t) => t.id === selectedId) ?? null;
  const mapPoints = live ? s.points : selectedTrip?.points ?? [];
  const mapKind: "live" | "history" = live ? "live" : "history";
  const lastPoint = mapPoints[mapPoints.length - 1];

  const today = useMemo(() => {
    const t = trips.filter((x) => sameDay(x.date, now));
    return {
      count: t.length,
      dist: t.reduce((a, x) => a + x.distanceM, 0),
      earn: t.reduce((a, x) => a + x.fare, 0),
    };
  }, [trips, now]);

  const gpsChip = (() => {
    if (live && simPref.on) return { label: "GPS จำลอง", cls: "border-mark/50 text-mark bg-mark/10" };
    if (s.accuracy == null) return { label: "รอสัญญาณ GPS", cls: "border-line text-dim" };
    if (s.accuracy <= 15) return { label: `GPS แม่นยำ ±${Math.round(s.accuracy)} ม.`, cls: "border-go/50 text-go bg-go/10" };
    if (s.accuracy <= 35) return { label: `GPS ดี ±${Math.round(s.accuracy)} ม.`, cls: "border-mark/50 text-mark bg-mark/10" };
    return { label: `GPS อ่อน ±${Math.round(s.accuracy)} ม.`, cls: "border-stop/50 text-stop bg-stop/10" };
  })();

  const handleStart = () => {
    setArmDiscard(false);
    setFocusNonce((n) => n + 1);
    engine.start();
    toast(simPref.on ? "เริ่มเที่ยวจำลอง — ล้อหมุนแล้ว" : "เริ่มบันทึก — ขอสิทธิ์ตำแหน่งจากเครื่อง", "ok");
  };

  const handleFinish = () => {
    if (s.points.length === 0) {
      engine.discard();
      toast("ยกเลิกเที่ยว — ยังไม่มีการเคลื่อนที่", "info");
      return;
    }
    engine.finish();
  };

  const handleDiscard = () => {
    if (!armDiscard) {
      setArmDiscard(true);
      if (armTimer.current) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArmDiscard(false), 2600);
      return;
    }
    setArmDiscard(false);
    engine.discard();
    toast("ยกเลิกเที่ยวแล้ว ไม่บันทึก", "info");
  };

  const statusRow = (() => {
    if (s.status === "paused")
      return { text: "พักมิเตอร์", dot: "bg-mark", pulse: false, cls: "text-mark border-mark/50 bg-mark/10" };
    if (finding)
      return { text: "กำลังหาสัญญาณ…", dot: "bg-mark", pulse: true, cls: "text-mark border-mark/50 bg-mark/10" };
    if (s.status === "tracking")
      return { text: "กำลังบันทึก REC", dot: "bg-stop", pulse: true, cls: "text-go border-go/50 bg-go/10" };
    return { text: "พร้อมรับเที่ยว", dot: "bg-dim", pulse: false, cls: "text-dim border-line" };
  })();

  const dist = fmtDistance(s.distanceM);

  return (
    <div ref={rootRef} className="min-h-screen pb-10">
      {/* ======= install banner ======= */}
      <InstallBanner onOpenGuide={() => setDeployGuideOpen(true)} />

      {/* ======= header ======= */}
      <header className="sticky top-0 z-50 border-b border-line bg-ink/85 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-vest text-ink shadow-[0_6px_18px_rgba(255,122,28,0.35)]">
              <HelmetIcon size={24} />
            </span>
            <div className="leading-tight">
              <p className="font-display text-[19px] font-extrabold tracking-tight">วินมิเตอร์</p>
              <p className="text-[9.5px] font-bold tracking-[0.22em] text-dim">WINMETER · GPS ODOMETER</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {simPref.on && (
              <span className="hidden items-center gap-1 rounded-lg border border-mark/50 bg-mark/10 px-2.5 py-1.5 text-[12px] font-bold text-mark sm:flex">
                <BoltIcon size={13} /> จำลอง
              </span>
            )}
            <span className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold md:flex ${gpsChip.cls}`}>
              <SignalIcon size={13} /> {gpsChip.label}
            </span>
            <button
              onClick={() => setGuideOpen(true)}
              aria-label="วิธีใช้งาน"
              className="btn-press grid h-10 w-10 place-items-center rounded-xl border border-line text-dim hover:border-vest/60 hover:text-vest"
              title="วิธีใช้งาน"
            >
              <InfoIcon size={19} />
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="ตั้งค่า"
              className="btn-press grid h-10 w-10 place-items-center rounded-xl border border-line text-dim hover:border-vest/60 hover:text-vest"
            >
              <GearIcon size={19} />
            </button>
          </div>
        </div>
        <div className="hazard h-[5px] w-full opacity-90" />
      </header>

      {/* ======= main ======= */}
      <main className="mx-auto mt-6 grid max-w-6xl gap-5 px-4 lg:grid-cols-[420px_minmax(0,1fr)]">
        {/* --- คอลัมน์มิเตอร์ --- */}
        <section className="flex flex-col gap-5">
          <div className="card relative overflow-hidden">
            <div className="hazard h-1.5 w-full opacity-80" />
            <div className="p-5">
              {/* สถานะ */}
              <div className="flex items-center justify-between gap-2">
                <span className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-bold ${statusRow.cls}`}>
                  <span className="relative flex h-2 w-2">
                    {statusRow.pulse && <span className={`ping-soft absolute inset-0 rounded-full ${statusRow.dot}`} />}
                    <span className={`relative h-2 w-2 rounded-full ${statusRow.dot}`} />
                  </span>
                  {statusRow.text}
                </span>
                <span className="num text-[12px] font-semibold text-dim">จุด {s.points.length} · ทิ้ง {s.skipped}</span>
              </div>

              <div className="mt-2">
                <SpeedDial speedMs={displaySpeed} active={s.status === "tracking" && displaySpeed > 0.5} />
              </div>

              {/* ระยะทาง + ค่าโดยสาร */}
              <div className="mt-1 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[12px] font-bold tracking-wide text-dim">ระยะทางสะสม</p>
                  <p className="num mt-0.5 text-[52px] font-extrabold leading-none tracking-tight">
                    {dist.value}
                    <span className="ml-1.5 text-xl font-bold text-dim">{dist.unit}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] font-bold tracking-wide text-dim">ค่าโดยสารตอนนี้</p>
                  <p className="num mt-0.5 text-[34px] font-extrabold leading-none text-mark">
                    {fmtBaht(live ? fareNow : 0)}
                    <span className="ml-1 text-base font-bold text-dim">฿</span>
                  </p>
                </div>
              </div>

              {/* แถบสถิติ */}
              <div className="mt-4 grid grid-cols-4 gap-2">
                {[
                  { l: "เวลาวิ่ง", v: fmtClock(elapsed), icon: <ClockIcon size={12} /> },
                  { l: "เฉลี่ย", v: elapsed > 4000 && s.distanceM > 0 ? fmtKmh(s.distanceM / (elapsed / 1000)) : "0", icon: <MotoIcon size={12} /> },
                  { l: "สูงสุด", v: fmtKmh(s.maxSpeed), icon: <FlagIcon size={12} /> },
                  { l: "พิกัดล่าสุด", v: lastPoint && live ? `±${Math.round(s.accuracy ?? 0)}ม.` : "—", icon: <PinIcon size={12} /> },
                ].map((x) => (
                  <div key={x.l} className="rounded-lg border border-line bg-pit/70 px-2.5 py-2">
                    <p className="flex items-center gap-1 text-[10.5px] font-semibold text-dim">{x.icon}{x.l}</p>
                    <p className="num mt-0.5 truncate text-[15px] font-bold leading-snug">{x.v}</p>
                  </div>
                ))}
              </div>

              {/* เส้นแบ่งถนนวิ่ง */}
              <div className="mt-5 h-[3px] w-full overflow-hidden rounded-full opacity-70">
                <div className="lane-dash h-full w-full" style={{ animationPlayState: s.status === "tracking" ? "running" : "paused" }} />
              </div>

              {/* ข้อผิดพลาด GPS */}
              {s.error && (
                <div className="pop-in mt-4 flex items-start gap-2 rounded-xl border border-stop/40 bg-stop/10 px-3.5 py-3 text-[13px] font-semibold leading-relaxed text-stop">
                  <InfoIcon size={16} className="mt-0.5 shrink-0" />
                  <span>{s.error}</span>
                </div>
              )}

              {/* ปุ่มควบคุม */}
              <div className="mt-5">
                {s.status === "idle" || s.status === "finished" ? (
                  <button
                    onClick={handleStart}
                    className="btn-press flex w-full items-center justify-center gap-2.5 rounded-xl bg-vest py-4 font-display text-xl font-bold text-ink shadow-[0_12px_30px_rgba(255,122,28,0.32)] hover:bg-mark"
                  >
                    <PlayIcon size={21} />
                    เริ่มเดินทาง
                  </button>
                ) : (
                  <>
                    <div className="flex gap-2.5">
                      {s.status === "tracking" ? (
                        <button
                          onClick={engine.pause}
                          className="btn-press flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-line py-3.5 font-display text-[16px] font-semibold hover:border-mark hover:text-mark"
                        >
                          <PauseIcon size={17} /> พัก
                        </button>
                      ) : (
                        <button
                          onClick={engine.resume}
                          className="btn-press flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-go/50 py-3.5 font-display text-[16px] font-semibold text-go hover:bg-go/10"
                        >
                          <PlayIcon size={16} /> เดินทางต่อ
                        </button>
                      )}
                      <button
                        onClick={handleFinish}
                        className="btn-press flex flex-1 items-center justify-center gap-2 rounded-xl bg-vest py-3.5 font-display text-[16px] font-bold text-ink shadow-[0_10px_24px_rgba(255,122,28,0.3)] hover:bg-mark"
                      >
                        <FlagIcon size={17} /> จบเที่ยว
                      </button>
                    </div>
                    <button
                      onClick={handleDiscard}
                      className={`btn-press mt-2.5 w-full rounded-lg py-2 text-[13px] font-bold transition-colors ${
                        armDiscard ? "bg-stop/15 text-stop" : "text-dim hover:text-stop"
                      }`}
                    >
                      {armDiscard ? "แน่ใจ? กดอีกครั้งเพื่อยกเลิกเที่ยว" : "ยกเลิกเที่ยวนี้ (ไม่บันทึก)"}
                    </button>
                  </>
                )}
                {s.status === "idle" && (
                  <p className="mt-2.5 text-center text-[12px] text-dim">
                    {simPref.on ? "โหมดจำลองเปิดอยู่ — จะวิ่งเส้นทางพหลโยธินเสมือนจริง" : "กดแล้วอนุญาตการเข้าถึงตำแหน่ง เพื่อเริ่มวัดระยะด้วย GPS"}
                  </p>
                )}
                {s.status === "idle" && trips.length === 0 && (
                  <>
                    <button
                      onClick={() => setDeployGuideOpen(true)}
                      className="btn-press mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-vest/50 bg-vest/10 py-3 text-[13px] font-bold text-vest hover:bg-vest/20"
                    >
                      <span className="text-lg">📲</span>
                      วิธีโหลดไปใช้บนมือถือ
                    </button>
                    <button
                      onClick={() => setGuideOpen(true)}
                      className="btn-press mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-mark/50 bg-mark/[0.05] py-3 text-[13px] font-bold text-mark hover:bg-mark/10"
                    >
                      <InfoIcon size={15} />
                      ไม่เคยใช้? อ่านคู่มือวิธีใช้งาน
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* --- สรุปวันนี้ --- */}
          <div className="card reveal p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">สรุปวันนี้</h2>
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-dim">
                <BahtIcon size={14} className="text-mark" /> อัปเดตอัตโนมัติ
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {[
                { l: "เที่ยวที่วิ่ง", v: String(today.count), u: "เที่ยว" },
                { l: "ระยะรวม", v: fmtKm(today.dist, today.dist >= 100000 ? 1 : 2), u: "กม." },
                { l: "รายได้", v: fmtBaht(today.earn), u: "บาท" },
              ].map((x) => (
                <div key={x.l} className="rounded-xl border border-line bg-pit/70 px-3 py-3 text-center transition-transform hover:-translate-y-0.5">
                  <p className="text-[11.5px] font-semibold text-dim">{x.l}</p>
                  <p className="num mt-1 text-[22px] font-extrabold leading-none text-paper">
                    {x.v}
                    <span className="ml-1 text-[11px] font-semibold text-dim">{x.u}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --- คอลัมน์แผนที่ + ประวัติ --- */}
        <section className="flex min-w-0 flex-col gap-5">
          <div className="card reveal overflow-hidden p-1.5">
            <div className="h-[400px] lg:h-[470px]">
              <MapView points={mapPoints} kind={mapKind} focusNonce={focusNonce}>
                {/* overlay มุมซ้ายบน */}
                <div className="pointer-events-none absolute left-3 top-3 z-[500] flex flex-col items-start gap-2">
                  <span
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-bold backdrop-blur ${
                      live
                        ? "border-vest/60 bg-[#241407]/90 text-vest"
                        : selectedTrip
                          ? "border-mark/50 bg-[#241d07]/90 text-mark"
                          : "border-line bg-panel/90 text-dim"
                    }`}
                  >
                    {live ? (
                      <>
                        <span className={`h-2 w-2 rounded-full bg-stop ${s.status === "tracking" ? "blink-rec" : ""}`} />
                        กำลังบันทึกเส้นทาง
                      </>
                    ) : selectedTrip ? (
                      <>
                        <PinIcon size={13} /> เส้นทางเที่ยวที่เลือก
                      </>
                    ) : (
                      <>
                        <SatelliteIcon size={13} /> รอสัญญาณออกตัว
                      </>
                    )}
                  </span>
                  {lastPoint && (
                    <span className="num rounded-md border border-line bg-panel/90 px-2 py-1 text-[11px] font-semibold text-dim backdrop-blur">
                      {fmtCoord(lastPoint.lat, lastPoint.lng)}
                    </span>
                  )}
                </div>
              </MapView>
            </div>
          </div>

          <div className="card reveal overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
              <h2 className="font-display text-lg font-bold">
                ประวัติเที่ยววิ่ง <span className="num text-[13px] font-semibold text-dim">({trips.length})</span>
              </h2>
              <span className="text-[12px] font-semibold text-dim">แตะเพื่อดูเส้นทางบนแผนที่</span>
            </div>
            <div className="max-h-[430px] overflow-y-auto">
              <TripHistory
                trips={trips}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId((cur) => (cur === id ? null : id));
                  setFocusNonce((n) => n + 1);
                }}
                onDelete={(id) => {
                  setTrips((prev) => prev.filter((t) => t.id !== id));
                  if (selectedId === id) setSelectedId(null);
                  toast("ลบเที่ยวออกจากประวัติแล้ว", "info");
                }}
              />
            </div>
          </div>
        </section>
      </main>

      {/* ======= วิธีโหลดไปใช้บนมือถือ ======= */}
      <div className="mx-auto mt-6 max-w-6xl px-4">
        <div className="card reveal overflow-hidden">
          <div className="border-b border-line bg-gradient-to-r from-vest/10 via-mark/5 to-transparent px-5 py-4">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold">
              <span className="text-xl">📲</span> วิธีโหลดไปใช้บนมือถือ (Cloudflare Pages)
            </h2>
            <p className="mt-0.5 text-[13px] text-dim">ใช้ Cloudflare Pages — ฟรี เร็ว ง่าย — ไม่ต้องใช้ GitHub!</p>
          </div>
          <div className="p-5">
            <div className="grid gap-4 md:grid-cols-3">
              {/* Step 1 */}
              <div className="rounded-xl border border-line bg-pit/40 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="num grid h-7 w-7 place-items-center rounded-lg bg-vest/20 text-[13px] font-extrabold text-vest">1</span>
                  <h3 className="font-display text-[14px] font-bold">Build ในเครื่อง</h3>
                </div>
                <p className="text-[12.5px] leading-relaxed text-dim">
                  รัน <code className="rounded bg-ink/60 px-1.5 py-0.5 text-[11px]">npm run build</code> → ได้โฟลเดอร์ <b className="text-paper">dist</b>
                </p>
              </div>
              {/* Step 2 */}
              <div className="rounded-xl border border-line bg-pit/40 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="num grid h-7 w-7 place-items-center rounded-lg bg-mark/20 text-[13px] font-extrabold text-mark">2</span>
                  <h3 className="font-display text-[14px] font-bold">อัพโหลดขึ้น Cloudflare</h3>
                </div>
                <p className="text-[12.5px] leading-relaxed text-dim">
                  เข้า <b className="text-paper">Cloudflare Pages</b> → ลากโฟลเดอร์ dist วาง → Deploy
                </p>
              </div>
              {/* Step 3 */}
              <div className="rounded-xl border border-line bg-pit/40 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="num grid h-7 w-7 place-items-center rounded-lg bg-go/20 text-[13px] font-extrabold text-go">3</span>
                  <h3 className="font-display text-[14px] font-bold">ติดตั้งบนมือถือ</h3>
                </div>
                <p className="text-[12.5px] leading-relaxed text-dim">
                  เปิด URL บนมือถือ → กดติดตั้ง<br />
                  iPhone: <b className="text-paper">Share → เพิ่ม</b><br />
                  Android: <b className="text-paper">⋮ → ติดตั้ง</b>
                </p>
              </div>
            </div>
            <button
              onClick={() => setDeployGuideOpen(true)}
              className="btn-press mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-vest py-3 font-display text-[14px] font-bold text-ink shadow-[0_8px 20px_rgba(255,122,28,0.25)] hover:bg-mark"
            >
              <span className="text-lg">☁️</span>
              อ่านคู่มือ Cloudflare แบบละเอียด (ทีละขั้นตอน)
            </button>
          </div>
        </div>
      </div>

      {/* ======= ข้อมูลล่าง ======= */}
      <div className="mx-auto mt-6 grid max-w-6xl gap-5 px-4 md:grid-cols-2">
        <div className="card reveal p-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <BahtIcon size={19} className="text-mark" /> อัตราค่าโดยสาร (กฎกระทรวง)
          </h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-dim">
            อัตราค่าโดยสารรถจักรยานยนต์สาธารณะ (วินป้ายเหลือง) ตามกฎกระทรวง กรมการขนส่งทางบก
          </p>
          <ul className="mt-3.5 space-y-2 text-[14px]">
            <li className="flex items-center justify-between rounded-lg border border-go/30 bg-go/5 px-3.5 py-2.5">
              <span>2 กม. แรก</span>
              <b className="num text-go">25 ฿</b>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-mark/30 bg-mark/5 px-3.5 py-2.5">
              <span>กม. ที่ 3–5 <span className="text-dim">(กม. ละ 5 ฿)</span></span>
              <b className="num text-mark">สูงสุด 40 ฿</b>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-vest/30 bg-vest/5 px-3.5 py-2.5">
              <span>กม. ที่ 6–15 <span className="text-dim">(กม. ละ 10 ฿)</span></span>
              <b className="num text-vest">สูงสุด 140 ฿</b>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-line bg-pit/60 px-3.5 py-2.5">
              <span>เกิน 15 กม. <span className="text-dim">(กม. ละ {fmtBaht(fare.perKmOver15)} ฿)</span></span>
              <b className="text-paper text-[13px]">ตามตกลง</b>
            </li>
          </ul>
          <p className="mt-3 rounded-lg border border-dashed border-mark/40 bg-mark/[0.06] px-3.5 py-2.5 text-[13px] text-dim">
            ตัวอย่าง: วิ่ง <b className="num text-paper">4.6 กม.</b> → 25 + (4.6 − 2) × 5 ={" "}
            <b className="num text-mark">38 บาท</b>
          </p>
          <p className="mt-2 rounded-lg border border-dashed border-vest/40 bg-vest/[0.05] px-3.5 py-2.5 text-[13px] text-dim">
            ตัวอย่าง: วิ่ง <b className="num text-paper">10.2 กม.</b> → 40 + (10.2 − 5) × 10 ={" "}
            <b className="num text-vest">92 บาท</b>
          </p>
        </div>

        <div className="card reveal p-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <SatelliteIcon size={19} className="text-vest" /> วัดระยะให้แม่นยำ
          </h2>
          <ul className="mt-3.5 space-y-3">
            {[
              { t: "เปิดโหมดความแม่นยำสูง", d: "ตั้งค่าตำแหน่งของเครื่องเป็น High accuracy เพื่อให้ได้จุด GPS ถี่และตรง" },
              { t: "ยึดเครื่องไว้หน้ารถ", d: "หลบหลังกองกระเป๋าหรือเสื้อกันฝนจะบังสัญญาณ ทำให้ระยะขาดหาย" },
              { t: "ระวังอุโมงค์และตึกสูง", d: "แอปทิ้งจุดที่คลาดเกิน 60 เมตร และไม่นับระยะช่วงสัญญาณขาดเกิน 45 วิ" },
              { t: "ซ้อมด้วยโหมดจำลอง", d: "เปิดสวิตช์ในการตั้งค่าเพื่อทดลองมิเตอร์บนเส้นทางพหลโยธินเสมือนจริง" },
            ].map((x, i) => (
              <li key={x.t} className="flex gap-3">
                <span className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-vest/15 text-[12px] font-extrabold text-vest">{i + 1}</span>
                <span>
                  <b className="block text-[14px] font-bold leading-snug">{x.t}</b>
                  <span className="text-[13px] leading-relaxed text-dim">{x.d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ======= footer ======= */}
      <footer className="mx-auto mt-8 max-w-6xl px-4">
        <div className="lane-dash h-[3px] w-full rounded-full opacity-40" />
        <div className="mt-4 flex flex-col items-center justify-between gap-2 text-[12px] text-dim sm:flex-row">
          <p className="flex items-center gap-1.5">
            <HelmetIcon size={15} className="text-vest" />
            วินมิเตอร์ — มิเตอร์วัดระยะมอเตอร์ไซค์รับจ้าง
          </p>
          <p>ตำแหน่งทั้งหมดประมวลผลบนเครื่องคุณ ไม่ส่งขึ้นเซิร์ฟเวอร์ · อัตราค่าโดยสารเป็นค่าอ้างอิง</p>
        </div>
      </footer>

      {/* ======= overlays ======= */}
      {guideOpen && <GuideModal onClose={() => setGuideOpen(false)} />}

      {deployGuideOpen && <DeployGuideModal onClose={() => setDeployGuideOpen(false)} />}

      {settingsOpen && (
        <SettingsModal
          settings={fare}
          simMode={simPref.on}
          tripCount={trips.length}
          onSave={setFare}
          onSimMode={(v) => {
            setSimPref({ on: v });
            toast(v ? "เปิดโหมดจำลองแล้ว" : "ปิดโหมดจำลอง — ใช้ GPS จริง", "info");
          }}
          onClearTrips={() => {
            setTrips([]);
            setSelectedId(null);
            setSettingsOpen(false);
            toast("ล้างประวัติทั้งหมดแล้ว", "ok");
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {lastSummary && <SummarySheet record={lastSummary} fare={fare} onClose={() => setLastSummary(null)} />}

      <Toasts items={toasts} />
    </div>
  );
}


+++ src/App.tsx (修改后)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SpeedDial from "./components/SpeedDial";
import MapView from "./components/MapView";
import TripHistory from "./components/TripHistory";
import { SettingsModal, SummarySheet, Toasts, type Toast } from "./components/Modals";
import GuideModal from "./components/GuideModal";
import DeployGuideModal from "./components/DeployGuideModal";
import InstallBanner from "./components/InstallBanner";
import {
  HelmetIcon, GearIcon, PlayIcon, PauseIcon, FlagIcon, BoltIcon, SignalIcon,
  BahtIcon, ClockIcon, InfoIcon, SatelliteIcon, MotoIcon, PinIcon,
} from "./components/icons";
import { useLocalStorage, useNow, useRevealObserver, useTripEngine } from "./hooks";
import { DEFAULT_FARE, elapsedMs, calcFare, type FareSettings, type TripRecord } from "./lib/trip";
import { fmtBaht, fmtClock, fmtCoord, fmtDistance, fmtKmh, fmtKm } from "./lib/geo";

const sameDay = (a: number, b: number) => {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

export default function App() {
  const [fare, setFare] = useLocalStorage<FareSettings>("winmeter:v1:fare", DEFAULT_FARE);
  const [simPref, setSimPref] = useLocalStorage<{ on: boolean }>("winmeter:v1:sim", { on: false });
  const [trips, setTrips] = useLocalStorage<TripRecord[]>("winmeter:v1:trips", []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<TripRecord | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [deployGuideOpen, setDeployGuideOpen] = useState(false);
  const [focusNonce, setFocusNonce] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [armDiscard, setArmDiscard] = useState(false);
  const armTimer = useRef<number | null>(null);

  const now = useNow(500);
  const rootRef = useRevealObserver<HTMLDivElement>();

  // Listen for deploy guide open event
  useEffect(() => {
    const handler = () => setDeployGuideOpen(true);
    window.addEventListener("open-deploy-guide", handler);
    return () => window.removeEventListener("open-deploy-guide", handler);
  }, []);

  const toast = useCallback((msg: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);

  const engine = useTripEngine({
    fare,
    simMode: simPref.on,
    onFinished: (rec) => {
      setTrips((prev) => [rec, ...prev]);
      setLastSummary(rec);
      setSelectedId(rec.id);
      setFocusNonce((n) => n + 1);
      toast("บันทึกเที่ยวลงประวัติแล้ว", "ok");
    },
    onError: (msg) => toast(msg, "err"),
    onRestored: () => toast("กู้คืนเที่ยวที่ค้างอยู่ — กดเดินทางต่อได้เลย", "info"),
  });

  const s = engine.state;
  const live = s.status === "tracking" || s.status === "paused";
  const finding = s.status === "tracking" && s.points.length === 0;

  /* ความเร็วที่แสดงผล — หน่วงเป็น 0 ถ้าสัญญาณหายเกิน 5 วิ */
  const displaySpeed =
    s.status === "tracking" && s.lastFixAt && now - s.lastFixAt > 5000 ? 0 : s.currentSpeed;

  const elapsed = elapsedMs(s, now);
  const fareNow = useMemo(() => calcFare(s.distanceM, fare), [s.distanceM, fare]);

  const selectedTrip = trips.find((t) => t.id === selectedId) ?? null;
  const mapPoints = live ? s.points : selectedTrip?.points ?? [];
  const mapKind: "live" | "history" = live ? "live" : "history";
  const lastPoint = mapPoints[mapPoints.length - 1];

  const today = useMemo(() => {
    const t = trips.filter((x) => sameDay(x.date, now));
    return {
      count: t.length,
      dist: t.reduce((a, x) => a + x.distanceM, 0),
      earn: t.reduce((a, x) => a + x.fare, 0),
    };
  }, [trips, now]);

  const gpsChip = (() => {
    if (live && simPref.on) return { label: "GPS จำลอง", cls: "border-mark/50 text-mark bg-mark/10" };
    if (s.accuracy == null) return { label: "รอสัญญาณ GPS", cls: "border-line text-dim" };
    if (s.accuracy <= 15) return { label: `GPS แม่นยำ ±${Math.round(s.accuracy)} ม.`, cls: "border-go/50 text-go bg-go/10" };
    if (s.accuracy <= 35) return { label: `GPS ดี ±${Math.round(s.accuracy)} ม.`, cls: "border-mark/50 text-mark bg-mark/10" };
    return { label: `GPS อ่อน ±${Math.round(s.accuracy)} ม.`, cls: "border-stop/50 text-stop bg-stop/10" };
  })();

  const handleStart = () => {
    setArmDiscard(false);
    setFocusNonce((n) => n + 1);
    engine.start();
    toast(simPref.on ? "เริ่มเที่ยวจำลอง — ล้อหมุนแล้ว" : "เริ่มบันทึก — ขอสิทธิ์ตำแหน่งจากเครื่อง", "ok");
  };

  const handleFinish = () => {
    if (s.points.length === 0) {
      engine.discard();
      toast("ยกเลิกเที่ยว — ยังไม่มีการเคลื่อนที่", "info");
      return;
    }
    engine.finish();
  };

  const handleDiscard = () => {
    if (!armDiscard) {
      setArmDiscard(true);
      if (armTimer.current) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArmDiscard(false), 2600);
      return;
    }
    setArmDiscard(false);
    engine.discard();
    toast("ยกเลิกเที่ยวแล้ว ไม่บันทึก", "info");
  };

  const statusRow = (() => {
    if (s.status === "paused")
      return { text: "พักมิเตอร์", dot: "bg-mark", pulse: false, cls: "text-mark border-mark/50 bg-mark/10" };
    if (finding)
      return { text: "กำลังหาสัญญาณ…", dot: "bg-mark", pulse: true, cls: "text-mark border-mark/50 bg-mark/10" };
    if (s.status === "tracking")
      return { text: "กำลังบันทึก REC", dot: "bg-stop", pulse: true, cls: "text-go border-go/50 bg-go/10" };
    return { text: "พร้อมรับเที่ยว", dot: "bg-dim", pulse: false, cls: "text-dim border-line" };
  })();

  const dist = fmtDistance(s.distanceM);

  return (
    <div ref={rootRef} className="min-h-screen pb-10">
      {/* ======= install banner ======= */}
      <InstallBanner onOpenGuide={() => setDeployGuideOpen(true)} />

      {/* ======= header ======= */}
      <header className="sticky top-0 z-50 border-b border-line bg-ink/85 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-vest text-ink shadow-[0_6px_18px_rgba(255,122,28,0.35)]">
              <HelmetIcon size={24} />
            </span>
            <div className="leading-tight">
              <p className="font-display text-[19px] font-extrabold tracking-tight">วินมิเตอร์</p>
              <p className="text-[9.5px] font-bold tracking-[0.22em] text-dim">WINMETER · GPS ODOMETER</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {simPref.on && (
              <span className="hidden items-center gap-1 rounded-lg border border-mark/50 bg-mark/10 px-2.5 py-1.5 text-[12px] font-bold text-mark sm:flex">
                <BoltIcon size={13} /> จำลอง
              </span>
            )}
            <span className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold md:flex ${gpsChip.cls}`}>
              <SignalIcon size={13} /> {gpsChip.label}
            </span>
            <button
              onClick={() => setGuideOpen(true)}
              aria-label="วิธีใช้งาน"
              className="btn-press grid h-10 w-10 place-items-center rounded-xl border border-line text-dim hover:border-vest/60 hover:text-vest"
              title="วิธีใช้งาน"
            >
              <InfoIcon size={19} />
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="ตั้งค่า"
              className="btn-press grid h-10 w-10 place-items-center rounded-xl border border-line text-dim hover:border-vest/60 hover:text-vest"
            >
              <GearIcon size={19} />
            </button>
          </div>
        </div>
        <div className="hazard h-[5px] w-full opacity-90" />
      </header>

      {/* ======= main ======= */}
      <main className="mx-auto mt-6 grid max-w-6xl gap-5 px-4 lg:grid-cols-[420px_minmax(0,1fr)]">
        {/* --- คอลัมน์มิเตอร์ --- */}
        <section className="flex flex-col gap-5">
          <div className="card relative overflow-hidden">
            <div className="hazard h-1.5 w-full opacity-80" />
            <div className="p-5">
              {/* สถานะ */}
              <div className="flex items-center justify-between gap-2">
                <span className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-bold ${statusRow.cls}`}>
                  <span className="relative flex h-2 w-2">
                    {statusRow.pulse && <span className={`ping-soft absolute inset-0 rounded-full ${statusRow.dot}`} />}
                    <span className={`relative h-2 w-2 rounded-full ${statusRow.dot}`} />
                  </span>
                  {statusRow.text}
                </span>
                <span className="num text-[12px] font-semibold text-dim">จุด {s.points.length} · ทิ้ง {s.skipped}</span>
              </div>

              <div className="mt-2">
                <SpeedDial speedMs={displaySpeed} active={s.status === "tracking" && displaySpeed > 0.5} />
              </div>

              {/* ระยะทาง + ค่าโดยสาร */}
              <div className="mt-1 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[12px] font-bold tracking-wide text-dim">ระยะทางสะสม</p>
                  <p className="num mt-0.5 text-[52px] font-extrabold leading-none tracking-tight">
                    {dist.value}
                    <span className="ml-1.5 text-xl font-bold text-dim">{dist.unit}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[12px] font-bold tracking-wide text-dim">ค่าโดยสารตอนนี้</p>
                  <p className="num mt-0.5 text-[34px] font-extrabold leading-none text-mark">
                    {fmtBaht(live ? fareNow : 0)}
                    <span className="ml-1 text-base font-bold text-dim">฿</span>
                  </p>
                </div>
              </div>

              {/* แถบสถิติ */}
              <div className="mt-4 grid grid-cols-4 gap-2">
                {[
                  { l: "เวลาวิ่ง", v: fmtClock(elapsed), icon: <ClockIcon size={12} /> },
                  { l: "เฉลี่ย", v: elapsed > 4000 && s.distanceM > 0 ? fmtKmh(s.distanceM / (elapsed / 1000)) : "0", icon: <MotoIcon size={12} /> },
                  { l: "สูงสุด", v: fmtKmh(s.maxSpeed), icon: <FlagIcon size={12} /> },
                  { l: "พิกัดล่าสุด", v: lastPoint && live ? `±${Math.round(s.accuracy ?? 0)}ม.` : "—", icon: <PinIcon size={12} /> },
                ].map((x) => (
                  <div key={x.l} className="rounded-lg border border-line bg-pit/70 px-2.5 py-2">
                    <p className="flex items-center gap-1 text-[10.5px] font-semibold text-dim">{x.icon}{x.l}</p>
                    <p className="num mt-0.5 truncate text-[15px] font-bold leading-snug">{x.v}</p>
                  </div>
                ))}
              </div>

              {/* เส้นแบ่งถนนวิ่ง */}
              <div className="mt-5 h-[3px] w-full overflow-hidden rounded-full opacity-70">
                <div className="lane-dash h-full w-full" style={{ animationPlayState: s.status === "tracking" ? "running" : "paused" }} />
              </div>

              {/* ข้อผิดพลาด GPS */}
              {s.error && (
                <div className="pop-in mt-4 flex items-start gap-2 rounded-xl border border-stop/40 bg-stop/10 px-3.5 py-3 text-[13px] font-semibold leading-relaxed text-stop">
                  <InfoIcon size={16} className="mt-0.5 shrink-0" />
                  <span>{s.error}</span>
                </div>
              )}

              {/* ปุ่มควบคุม */}
              <div className="mt-5">
                {s.status === "idle" || s.status === "finished" ? (
                  <button
                    onClick={handleStart}
                    className="btn-press flex w-full items-center justify-center gap-2.5 rounded-xl bg-vest py-4 font-display text-xl font-bold text-ink shadow-[0_12px_30px_rgba(255,122,28,0.32)] hover:bg-mark"
                  >
                    <PlayIcon size={21} />
                    เริ่มเดินทาง
                  </button>
                ) : (
                  <>
                    <div className="flex gap-2.5">
                      {s.status === "tracking" ? (
                        <button
                          onClick={engine.pause}
                          className="btn-press flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-line py-3.5 font-display text-[16px] font-semibold hover:border-mark hover:text-mark"
                        >
                          <PauseIcon size={17} /> พัก
                        </button>
                      ) : (
                        <button
                          onClick={engine.resume}
                          className="btn-press flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-go/50 py-3.5 font-display text-[16px] font-semibold text-go hover:bg-go/10"
                        >
                          <PlayIcon size={16} /> เดินทางต่อ
                        </button>
                      )}
                      <button
                        onClick={handleFinish}
                        className="btn-press flex flex-1 items-center justify-center gap-2 rounded-xl bg-vest py-3.5 font-display text-[16px] font-bold text-ink shadow-[0_10px_24px_rgba(255,122,28,0.3)] hover:bg-mark"
                      >
                        <FlagIcon size={17} /> จบเที่ยว
                      </button>
                    </div>
                    <button
                      onClick={handleDiscard}
                      className={`btn-press mt-2.5 w-full rounded-lg py-2 text-[13px] font-bold transition-colors ${
                        armDiscard ? "bg-stop/15 text-stop" : "text-dim hover:text-stop"
                      }`}
                    >
                      {armDiscard ? "แน่ใจ? กดอีกครั้งเพื่อยกเลิกเที่ยว" : "ยกเลิกเที่ยวนี้ (ไม่บันทึก)"}
                    </button>
                  </>
                )}
                {s.status === "idle" && (
                  <p className="mt-2.5 text-center text-[12px] text-dim">
                    {simPref.on ? "โหมดจำลองเปิดอยู่ — จะวิ่งเส้นทางพหลโยธินเสมือนจริง" : "กดแล้วอนุญาตการเข้าถึงตำแหน่ง เพื่อเริ่มวัดระยะด้วย GPS"}
                  </p>
                )}
                {s.status === "idle" && trips.length === 0 && (
                  <>
                    <button
                      onClick={() => setDeployGuideOpen(true)}
                      className="btn-press mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-vest/50 bg-vest/10 py-3 text-[13px] font-bold text-vest hover:bg-vest/20"
                    >
                      <span className="text-lg">📲</span>
                      วิธีโหลดไปใช้บนมือถือ
                    </button>
                    <button
                      onClick={() => setGuideOpen(true)}
                      className="btn-press mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-mark/50 bg-mark/[0.05] py-3 text-[13px] font-bold text-mark hover:bg-mark/10"
                    >
                      <InfoIcon size={15} />
                      ไม่เคยใช้? อ่านคู่มือวิธีใช้งาน
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* --- สรุปวันนี้ --- */}
          <div className="card reveal p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">สรุปวันนี้</h2>
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-dim">
                <BahtIcon size={14} className="text-mark" /> อัปเดตอัตโนมัติ
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {[
                { l: "เที่ยวที่วิ่ง", v: String(today.count), u: "เที่ยว" },
                { l: "ระยะรวม", v: fmtKm(today.dist, today.dist >= 100000 ? 1 : 2), u: "กม." },
                { l: "รายได้", v: fmtBaht(today.earn), u: "บาท" },
              ].map((x) => (
                <div key={x.l} className="rounded-xl border border-line bg-pit/70 px-3 py-3 text-center transition-transform hover:-translate-y-0.5">
                  <p className="text-[11.5px] font-semibold text-dim">{x.l}</p>
                  <p className="num mt-1 text-[22px] font-extrabold leading-none text-paper">
                    {x.v}
                    <span className="ml-1 text-[11px] font-semibold text-dim">{x.u}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --- คอลัมน์แผนที่ + ประวัติ --- */}
        <section className="flex min-w-0 flex-col gap-5">
          <div className="card reveal overflow-hidden p-1.5">
            <div className="h-[400px] lg:h-[470px]">
              <MapView points={mapPoints} kind={mapKind} focusNonce={focusNonce}>
                {/* overlay มุมซ้ายบน */}
                <div className="pointer-events-none absolute left-3 top-3 z-[500] flex flex-col items-start gap-2">
                  <span
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-bold backdrop-blur ${
                      live
                        ? "border-vest/60 bg-[#241407]/90 text-vest"
                        : selectedTrip
                          ? "border-mark/50 bg-[#241d07]/90 text-mark"
                          : "border-line bg-panel/90 text-dim"
                    }`}
                  >
                    {live ? (
                      <>
                        <span className={`h-2 w-2 rounded-full bg-stop ${s.status === "tracking" ? "blink-rec" : ""}`} />
                        กำลังบันทึกเส้นทาง
                      </>
                    ) : selectedTrip ? (
                      <>
                        <PinIcon size={13} /> เส้นทางเที่ยวที่เลือก
                      </>
                    ) : (
                      <>
                        <SatelliteIcon size={13} /> รอสัญญาณออกตัว
                      </>
                    )}
                  </span>
                  {lastPoint && (
                    <span className="num rounded-md border border-line bg-panel/90 px-2 py-1 text-[11px] font-semibold text-dim backdrop-blur">
                      {fmtCoord(lastPoint.lat, lastPoint.lng)}
                    </span>
                  )}
                </div>
              </MapView>
            </div>
          </div>

          <div className="card reveal overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
              <h2 className="font-display text-lg font-bold">
                ประวัติเที่ยววิ่ง <span className="num text-[13px] font-semibold text-dim">({trips.length})</span>
              </h2>
              <span className="text-[12px] font-semibold text-dim">แตะเพื่อดูเส้นทางบนแผนที่</span>
            </div>
            <div className="max-h-[430px] overflow-y-auto">
              <TripHistory
                trips={trips}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId((cur) => (cur === id ? null : id));
                  setFocusNonce((n) => n + 1);
                }}
                onDelete={(id) => {
                  setTrips((prev) => prev.filter((t) => t.id !== id));
                  if (selectedId === id) setSelectedId(null);
                  toast("ลบเที่ยวออกจากประวัติแล้ว", "info");
                }}
              />
            </div>
          </div>
        </section>
      </main>

      {/* ======= วิธีโหลดไปใช้บนมือถือ ======= */}
      <div className="mx-auto mt-6 max-w-6xl px-4">
        <div className="card reveal overflow-hidden">
          <div className="border-b border-line bg-gradient-to-r from-vest/10 via-mark/5 to-transparent px-5 py-4">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold">
              <span className="text-xl">📲</span> วิธีโหลดไปใช้บนมือถือ (Cloudflare Pages)
            </h2>
            <p className="mt-0.5 text-[13px] text-dim">ใช้ Cloudflare Pages — ฟรี เร็ว ง่าย — ไม่ต้องใช้ GitHub!</p>
          </div>
          <div className="p-5">
            <div className="grid gap-4 md:grid-cols-3">
              {/* Step 1 */}
              <div className="rounded-xl border border-line bg-pit/40 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="num grid h-7 w-7 place-items-center rounded-lg bg-vest/20 text-[13px] font-extrabold text-vest">1</span>
                  <h3 className="font-display text-[14px] font-bold">Build ในเครื่อง</h3>
                </div>
                <p className="text-[12.5px] leading-relaxed text-dim">
                  รัน <code className="rounded bg-ink/60 px-1.5 py-0.5 text-[11px]">npm run build</code> → ได้โฟลเดอร์ <b className="text-paper">dist</b>
                </p>
              </div>
              {/* Step 2 */}
              <div className="rounded-xl border border-line bg-pit/40 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="num grid h-7 w-7 place-items-center rounded-lg bg-mark/20 text-[13px] font-extrabold text-mark">2</span>
                  <h3 className="font-display text-[14px] font-bold">อัพโหลดขึ้น Cloudflare</h3>
                </div>
                <p className="text-[12.5px] leading-relaxed text-dim">
                  เข้า <b className="text-paper">Cloudflare Pages</b> → ลากโฟลเดอร์ dist วาง → Deploy
                </p>
              </div>
              {/* Step 3 */}
              <div className="rounded-xl border border-line bg-pit/40 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="num grid h-7 w-7 place-items-center rounded-lg bg-go/20 text-[13px] font-extrabold text-go">3</span>
                  <h3 className="font-display text-[14px] font-bold">ติดตั้งบนมือถือ</h3>
                </div>
                <p className="text-[12.5px] leading-relaxed text-dim">
                  เปิด URL บนมือถือ → กดติดตั้ง<br />
                  iPhone: <b className="text-paper">Share → เพิ่ม</b><br />
                  Android: <b className="text-paper">⋮ → ติดตั้ง</b>
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => setDeployGuideOpen(true)}
                className="btn-press flex flex-1 items-center justify-center gap-2 rounded-xl bg-vest py-3 font-display text-[14px] font-bold text-ink shadow-[0_8px 20px_rgba(255,122,28,0.25)] hover:bg-mark"
              >
                <span className="text-lg">☁️</span>
                อ่านคู่มือ Cloudflare แบบละเอียด
              </button>
              <a
                href="/guide-cloudflare-github.html"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-press flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-vest/50 bg-vest/10 py-3 font-display text-[14px] font-bold text-vest hover:bg-vest/20"
              >
                <span className="text-lg">📘</span>
                คู่มือฉบับเต็ม (สำหรับมือใหม่)
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ======= ข้อมูลล่าง ======= */}
      <div className="mx-auto mt-6 grid max-w-6xl gap-5 px-4 md:grid-cols-2">
        <div className="card reveal p-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <BahtIcon size={19} className="text-mark" /> อัตราค่าโดยสาร (กฎกระทรวง)
          </h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-dim">
            อัตราค่าโดยสารรถจักรยานยนต์สาธารณะ (วินป้ายเหลือง) ตามกฎกระทรวง กรมการขนส่งทางบก
          </p>
          <ul className="mt-3.5 space-y-2 text-[14px]">
            <li className="flex items-center justify-between rounded-lg border border-go/30 bg-go/5 px-3.5 py-2.5">
              <span>2 กม. แรก</span>
              <b className="num text-go">25 ฿</b>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-mark/30 bg-mark/5 px-3.5 py-2.5">
              <span>กม. ที่ 3–5 <span className="text-dim">(กม. ละ 5 ฿)</span></span>
              <b className="num text-mark">สูงสุด 40 ฿</b>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-vest/30 bg-vest/5 px-3.5 py-2.5">
              <span>กม. ที่ 6–15 <span className="text-dim">(กม. ละ 10 ฿)</span></span>
              <b className="num text-vest">สูงสุด 140 ฿</b>
            </li>
            <li className="flex items-center justify-between rounded-lg border border-line bg-pit/60 px-3.5 py-2.5">
              <span>เกิน 15 กม. <span className="text-dim">(กม. ละ {fmtBaht(fare.perKmOver15)} ฿)</span></span>
              <b className="text-paper text-[13px]">ตามตกลง</b>
            </li>
          </ul>
          <p className="mt-3 rounded-lg border border-dashed border-mark/40 bg-mark/[0.06] px-3.5 py-2.5 text-[13px] text-dim">
            ตัวอย่าง: วิ่ง <b className="num text-paper">4.6 กม.</b> → 25 + (4.6 − 2) × 5 ={" "}
            <b className="num text-mark">38 บาท</b>
          </p>
          <p className="mt-2 rounded-lg border border-dashed border-vest/40 bg-vest/[0.05] px-3.5 py-2.5 text-[13px] text-dim">
            ตัวอย่าง: วิ่ง <b className="num text-paper">10.2 กม.</b> → 40 + (10.2 − 5) × 10 ={" "}
            <b className="num text-vest">92 บาท</b>
          </p>
        </div>

        <div className="card reveal p-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <SatelliteIcon size={19} className="text-vest" /> วัดระยะให้แม่นยำ
          </h2>
          <ul className="mt-3.5 space-y-3">
            {[
              { t: "เปิดโหมดความแม่นยำสูง", d: "ตั้งค่าตำแหน่งของเครื่องเป็น High accuracy เพื่อให้ได้จุด GPS ถี่และตรง" },
              { t: "ยึดเครื่องไว้หน้ารถ", d: "หลบหลังกองกระเป๋าหรือเสื้อกันฝนจะบังสัญญาณ ทำให้ระยะขาดหาย" },
              { t: "ระวังอุโมงค์และตึกสูง", d: "แอปทิ้งจุดที่คลาดเกิน 60 เมตร และไม่นับระยะช่วงสัญญาณขาดเกิน 45 วิ" },
              { t: "ซ้อมด้วยโหมดจำลอง", d: "เปิดสวิตช์ในการตั้งค่าเพื่อทดลองมิเตอร์บนเส้นทางพหลโยธินเสมือนจริง" },
            ].map((x, i) => (
              <li key={x.t} className="flex gap-3">
                <span className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-vest/15 text-[12px] font-extrabold text-vest">{i + 1}</span>
                <span>
                  <b className="block text-[14px] font-bold leading-snug">{x.t}</b>
                  <span className="text-[13px] leading-relaxed text-dim">{x.d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ======= footer ======= */}
      <footer className="mx-auto mt-8 max-w-6xl px-4">
        <div className="lane-dash h-[3px] w-full rounded-full opacity-40" />
        <div className="mt-4 flex flex-col items-center justify-between gap-2 text-[12px] text-dim sm:flex-row">
          <p className="flex items-center gap-1.5">
            <HelmetIcon size={15} className="text-vest" />
            วินมิเตอร์ — มิเตอร์วัดระยะมอเตอร์ไซค์รับจ้าง
          </p>
          <p>ตำแหน่งทั้งหมดประมวลผลบนเครื่องคุณ ไม่ส่งขึ้นเซิร์ฟเวอร์ · อัตราค่าโดยสารเป็นค่าอ้างอิง</p>
        </div>
      </footer>

      {/* ======= overlays ======= */}
      {guideOpen && <GuideModal onClose={() => setGuideOpen(false)} />}

      {deployGuideOpen && <DeployGuideModal onClose={() => setDeployGuideOpen(false)} />}

      {settingsOpen && (
        <SettingsModal
          settings={fare}
          simMode={simPref.on}
          tripCount={trips.length}
          onSave={setFare}
          onSimMode={(v) => {
            setSimPref({ on: v });
            toast(v ? "เปิดโหมดจำลองแล้ว" : "ปิดโหมดจำลอง — ใช้ GPS จริง", "info");
          }}
          onClearTrips={() => {
            setTrips([]);
            setSelectedId(null);
            setSettingsOpen(false);
            toast("ล้างประวัติทั้งหมดแล้ว", "ok");
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {lastSummary && <SummarySheet record={lastSummary} fare={fare} onClose={() => setLastSummary(null)} />}

      <Toasts items={toasts} />
    </div>
  );
}
