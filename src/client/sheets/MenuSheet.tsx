import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { LIMITS } from '../../shared/constants';
import { formatChips, formatSigned } from '../../shared/format';
import type { GameSettings, PublicPlayer, RoomView } from '../../shared/types';
import { Avatar } from '../components/Avatar';
import { Field, Toggle } from '../components/controls';
import { IconChat, IconCoins, IconCrown, IconGear, IconList, IconSend, IconUsers } from '../components/Icons';
import { SettingsForm } from '../components/SettingsForm';
import { Sheet } from '../components/Sheet';
import { pendingRequests, reservedSeats, seatedPlayers, spectators } from '../lib/gameState';
import { groupLog } from '../lib/logGroups';
import { hasErrors, minSeatsAllowed, settingsDiff, validateName, validateSettings } from '../lib/settingsForm';
import { actions } from '../net/actions';
import { leaveRoom } from '../net/room';
import { closeMenu, setMenuTab, setPrefs, useStore, type MenuTab } from '../state/store';
import { seatTag } from '../table/Seat';

const TABS: { id: MenuTab; label: string; Icon: (p: React.SVGProps<SVGSVGElement>) => React.JSX.Element }[] = [
  { id: 'players', label: 'Players', Icon: IconUsers },
  { id: 'log', label: 'Log', Icon: IconList },
  { id: 'chat', label: 'Chat', Icon: IconChat },
  { id: 'ledger', label: 'Ledger', Icon: IconCoins },
  { id: 'settings', label: 'Settings', Icon: IconGear },
];

export function MenuSheet({ room }: { room: RoomView }) {
  const tab = useStore((s) => s.ui.menuTab);
  const unread = useStore((s) => s.unreadChat);
  const requests = room.me.isHost ? pendingRequests(room).length : 0;
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  return (
    <Sheet title={current.label} onClose={closeMenu} tall className="menu-sheet">
      <nav className="tabs" role="tablist" aria-label="Menu sections">
        {TABS.map((t) => {
          const badge = t.id === 'chat' ? unread : t.id === 'players' ? requests : 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={t.id === tab}
              data-testid={`tab-${t.id}`}
              onClick={() => setMenuTab(t.id)}
            >
              <t.Icon />
              <span>{t.label}</span>
              {badge ? <span className="badge">{badge > 9 ? '9+' : badge}</span> : null}
            </button>
          );
        })}
      </nav>
      {tab === 'players' ? <PlayersTab room={room} /> : null}
      {tab === 'log' ? <LogTab /> : null}
      {tab === 'chat' ? <ChatTab room={room} /> : null}
      {tab === 'ledger' ? <LedgerTab room={room} /> : null}
      {tab === 'settings' ? <SettingsTab room={room} /> : null}
    </Sheet>
  );
}

// ------------------------------------------------------------------ Players
function PlayerRow({ p, room }: { p: PublicPlayer; room: RoomView }) {
  const [confirm, setConfirm] = useState<'kick' | 'host' | null>(null);
  const isMe = p.id === room.me.playerId;
  const tag = p.seat !== null ? seatTag(p, room.hand, room.started) : null;
  const status = [
    p.seat !== null ? `Seat ${p.seat + 1}` : p.pendingSeat !== null ? `Wants seat ${p.pendingSeat + 1}` : 'Watching',
    tag?.text,
    !p.connected && tag?.text !== 'Offline' ? 'Offline' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="prow">
      <Avatar name={p.name} color={p.color} size={40} />
      <div className="prow-main">
        <span className="prow-name">
          {p.name}
          {isMe ? <span className="you-tag">you</span> : null}
          {p.isHost ? <IconCrown className="prow-crown" aria-label="Host" /> : null}
        </span>
        <span className="prow-status">{status}</span>
      </div>
      <span className="prow-stack">{p.buyIns > 0 || p.seat !== null ? formatChips(p.stack) : '—'}</span>
      {room.me.isHost && !isMe ? (
        <div className="prow-actions">
          {confirm ? (
            <>
              <button type="button" className="btn btn-white btn-xs" onClick={() => setConfirm(null)}>
                No
              </button>
              <button
                type="button"
                className={`btn ${confirm === 'kick' ? 'btn-red' : 'btn-purple'} btn-xs`}
                onClick={() => {
                  void (confirm === 'kick' ? actions.kick(p.id) : actions.transfer(p.id));
                  setConfirm(null);
                }}
              >
                {confirm === 'kick' ? 'Kick?' : 'Make host?'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-white btn-xs" aria-label={`Make ${p.name} host`} onClick={() => setConfirm('host')}>
                Host
              </button>
              <button type="button" className="btn btn-white btn-xs prow-kick" aria-label={`Kick ${p.name}`} onClick={() => setConfirm('kick')}>
                Kick
              </button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function PlayersTab({ room }: { room: RoomView }) {
  const requests = room.me.isHost ? pendingRequests(room) : [];
  const seated = seatedPlayers(room);
  const watching = spectators(room).filter((p) => !requests.includes(p));
  return (
    <div className="sheet-body">
      {room.me.isHost ? (
        <div className="host-bar">
          {room.status === 'paused' ? (
            <button type="button" className="btn btn-green btn-sm" onClick={() => void actions.resume()}>
              Resume game
            </button>
          ) : room.status === 'running' ? (
            <button type="button" className="btn btn-white btn-sm" onClick={() => void actions.pause()}>
              Pause after this hand
            </button>
          ) : (
            <span className="host-note">You’re the host · start from the table</span>
          )}
        </div>
      ) : null}
      {requests.length ? (
        <section className="menu-section">
          <h3 className="menu-h">Seat requests</h3>
          <ul className="plist">
            {requests.map((p) => (
              <li key={p.id} className="prow is-request">
                <Avatar name={p.name} color={p.color} size={40} />
                <div className="prow-main">
                  <span className="prow-name">{p.name}</span>
                  <span className="prow-status">Wants seat {(p.pendingSeat ?? 0) + 1}</span>
                </div>
                <div className="prow-actions">
                  <button type="button" className="btn btn-white btn-xs" onClick={() => void actions.approveSeat(p.id, false)}>
                    Deny
                  </button>
                  <button type="button" className="btn btn-green btn-xs" onClick={() => void actions.approveSeat(p.id, true)}>
                    Approve
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="menu-section">
        <h3 className="menu-h">
          At the table <span>
            {seated.length}/{room.settings.maxPlayers}
          </span>
        </h3>
        {seated.length ? (
          <ul className="plist">
            {seated.map((p) => (
              <PlayerRow key={p.id} p={p} room={room} />
            ))}
          </ul>
        ) : (
          <p className="menu-empty">Nobody has sat down yet.</p>
        )}
      </section>
      <section className="menu-section">
        <h3 className="menu-h">
          Watching <span>{watching.length}</span>
        </h3>
        {watching.length ? (
          <ul className="plist">
            {watching.map((p) => (
              <PlayerRow key={p.id} p={p} room={room} />
            ))}
          </ul>
        ) : (
          <p className="menu-empty">No spectators.</p>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Log
function LogTab() {
  const log = useStore((s) => s.log);
  const groups = useMemo(() => groupLog(log), [log]);
  if (!log.length) {
    return (
      <div className="sheet-body">
        <p className="menu-empty">Nothing yet — the hand history shows up here.</p>
      </div>
    );
  }
  return (
    <div className="sheet-body log">
      {groups.map((g) => (
        <section key={g.key} className="log-group">
          <h3 className="menu-h">{g.title}</h3>
          <ol className="log-list">
            {g.entries.map((e) => (
              <li key={e.id} className={`log-entry kind-${e.kind}`}>
                <time>{new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Chat
const QUICK = ['👍', '😂', '🔥', '😭', '😮', '🙏', 'nh', 'gg', 'ty', 'lol'];

function ChatTab({ room }: { room: RoomView }) {
  const chat = useStore((s) => s.chat);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);
  const send = async (t: string) => {
    const msg = t.trim().slice(0, LIMITS.chatMaxLength);
    if (!msg || busy) return;
    setBusy(true);
    const res = await actions.sendChat(msg);
    setBusy(false);
    if (res.ok && msg === text.trim()) setText('');
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };
  return (
    <>
      <div className="sheet-body chat" ref={listRef}>
        {chat.length === 0 ? <p className="menu-empty">Say hi to the table 👋</p> : null}
        {chat.map((m, i) => {
          const mine = m.playerId === room.me.playerId;
          const prev = chat[i - 1];
          const showName = !mine && !m.system && (!prev || prev.playerId !== m.playerId || prev.system);
          if (m.system) {
            return (
              <p key={m.id} className="chat-system">
                {m.text}
              </p>
            );
          }
          return (
            <div key={m.id} className={`chat-msg ${mine ? 'is-mine' : ''}`}>
              {showName ? <span className="chat-name">{m.name}</span> : null}
              <span className="chat-bubble">{m.text}</span>
            </div>
          );
        })}
      </div>
      <div className="chat-compose">
        <div className="quick-row" role="group" aria-label="Quick replies">
          {QUICK.map((q) => (
            <button key={q} type="button" className="quick-btn" onClick={() => void send(q)}>
              {q}
            </button>
          ))}
        </div>
        <form className="chat-form" onSubmit={onSubmit}>
          <input
            className="text-input"
            aria-label="Message"
            data-testid="chat-input"
            placeholder="Message the table"
            value={text}
            maxLength={LIMITS.chatMaxLength}
            enterKeyHint="send"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn btn-blue btn-sm" aria-label="Send" disabled={!text.trim() || busy}>
            <IconSend width={20} height={20} />
          </button>
        </form>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Ledger
function LedgerTab({ room }: { room: RoomView }) {
  const rows = [...room.ledger].sort((a, b) => b.net - a.net);
  return (
    <div className="sheet-body">
      <p className="ledger-note">
        One buy-in of {formatChips(room.settings.buyIn)} each. Approved buy-backs count as extra buy-ins.
      </p>
      {rows.length === 0 ? (
        <p className="menu-empty">Nobody has bought in yet.</p>
      ) : (
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col" className="num">
                Buy-ins
              </th>
              <th scope="col" className="num">
                In
              </th>
              <th scope="col" className="num">
                Stack
              </th>
              <th scope="col" className="num">
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.playerId}
                className={r.inRoom ? '' : 'is-left'}
                data-testid="ledger-row"
                data-name={r.name}
                data-buyins={r.buyIns}
                data-total-buyin={r.totalBuyIn}
                data-stack={r.stack}
                data-net={r.net}
              >
                <th scope="row">
                  {r.name}
                  {r.playerId === room.me.playerId ? <span className="you-tag">you</span> : null}
                  {!r.inRoom ? <small> (left)</small> : null}
                </th>
                <td className="num">{r.buyIns}</td>
                <td className="num">{formatChips(r.totalBuyIn, true)}</td>
                <td className="num">{formatChips(r.stack, true)}</td>
                <td className={`num net ${r.net > 0 ? 'is-up' : r.net < 0 ? 'is-down' : ''}`}>{formatSigned(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Settings
function HostSettings({ room }: { room: RoomView }) {
  const [draft, setDraft] = useState<GameSettings>(room.settings);
  const [busy, setBusy] = useState(false);
  const baseRef = useRef(room.settings);
  // follow server changes when the draft hasn't been touched
  useEffect(() => {
    if (Object.keys(settingsDiff(baseRef.current, draft)).length === 0) setDraft(room.settings);
    baseRef.current = room.settings;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.settings]);
  const errors = validateSettings(draft);
  const diff = settingsDiff(room.settings, draft);
  if (room.started) delete diff.buyIn;
  const dirty = Object.keys(diff).length > 0;
  const save = async () => {
    if (!dirty || hasErrors(errors)) return;
    setBusy(true);
    await actions.updateSettings(diff);
    setBusy(false);
  };
  return (
    <section className="menu-section">
      <h3 className="menu-h">Table settings (host)</h3>
      <SettingsForm
        idPrefix="edit"
        value={draft}
        onChange={setDraft}
        errors={errors}
        lockedBuyIn={room.started}
        minSeats={minSeatsAllowed(room.seats, reservedSeats(room))}
      />
      <div className="settings-save">
        <button type="button" className="btn btn-white btn-sm" disabled={!dirty || busy} onClick={() => setDraft(room.settings)}>
          Reset
        </button>
        <button
          type="button"
          className="btn btn-green btn-sm"
          data-testid="save-settings"
          disabled={!dirty || hasErrors(errors) || busy}
          onClick={() => void save()}
        >
          Save changes
        </button>
      </div>
      <div className="host-bar">
        {room.status === 'paused' ? (
          <button type="button" className="btn btn-green btn-sm" onClick={() => void actions.resume()}>
            Resume game
          </button>
        ) : room.status === 'running' ? (
          <button type="button" className="btn btn-white btn-sm" onClick={() => void actions.pause()}>
            Pause game
          </button>
        ) : null}
      </div>
    </section>
  );
}

function SettingsTab({ room }: { room: RoomView }) {
  const prefs = useStore((s) => s.prefs);
  const me = room.players.find((p) => p.id === room.me.playerId);
  const [name, setName] = useState(room.me.name);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const nameError = validateName(name);
  const seated = !!me && me.seat !== null;
  return (
    <div className="sheet-body">
      {room.me.isHost ? <HostSettings room={room} /> : null}
      <section className="menu-section">
        <h3 className="menu-h">You</h3>
        <form
          className="rename-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nameError && name.trim() !== room.me.name) void actions.rename(name.trim());
          }}
        >
          <Field label="Display name" htmlFor="rename" error={name.trim() ? nameError : null}>
            <div className="join-row">
              <input
                id="rename"
                className="text-input"
                value={name}
                maxLength={LIMITS.nameMaxLength}
                onChange={(e) => setName(e.target.value)}
              />
              <button type="submit" className="btn btn-purple btn-sm" disabled={!!nameError || name.trim() === room.me.name}>
                Save
              </button>
            </div>
          </Field>
        </form>
        <Toggle label="Sound" checked={prefs.sound} onChange={(v) => setPrefs({ sound: v })} />
        <Toggle label="Vibration" hint="On phones that support it" checked={prefs.haptics} onChange={(v) => setPrefs({ haptics: v })} />
        <Toggle
          label="Four-colour deck"
          hint="♦ blue · ♣ green · ♥ red · ♠ black"
          checked={prefs.fourColor}
          onChange={(v) => setPrefs({ fourColor: v })}
        />
        {seated ? (
          <Toggle
            label="Sit out next hands"
            hint="Stay in your seat without being dealt in"
            checked={me!.sittingOut}
            onChange={(v) => void actions.sitOut(v)}
          />
        ) : null}
      </section>
      <section className="menu-section danger-zone">
        {seated ? (
          <button type="button" className="btn btn-white btn-block" onClick={() => void actions.standUp()}>
            Stand up (keep my chips)
          </button>
        ) : null}
        {confirmLeave ? (
          <div className="confirm-row">
            <span>Leave the room? Your stack is frozen in the ledger.</span>
            <button type="button" className="btn btn-white btn-sm" onClick={() => setConfirmLeave(false)}>
              Stay
            </button>
            <button type="button" className="btn btn-red btn-sm" data-testid="leave-confirm" onClick={() => void leaveRoom()}>
              Leave
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-red btn-block" data-testid="leave-room" onClick={() => setConfirmLeave(true)}>
            Leave room
          </button>
        )}
      </section>
    </div>
  );
}
