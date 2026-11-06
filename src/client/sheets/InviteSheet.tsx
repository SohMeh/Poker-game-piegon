import { useRef } from 'react';
import { formatChips } from '../../shared/format';
import type { RoomView } from '../../shared/types';
import { IconCopy, IconMessage, IconShare } from '../components/Icons';
import { BirdMascot } from '../components/Logo';
import { Sheet } from '../components/Sheet';
import { seatsTaken } from '../lib/gameState';
import { roomPath } from '../lib/route';
import { isEmbedded } from '../native/bridge';
import { sendInvite } from '../native/embed';
import { setUI, toast } from '../state/store';

export const INVITE_TEXT = 'Pull up a chair — No-Limit Hold’em, tap to join';

export function inviteUrl(roomId: string): string {
  return `${window.location.origin}${roomPath(roomId)}`;
}

async function copyText(text: string, input?: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      if (input) {
        input.select();
        input.setSelectionRange(0, text.length);
      }
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export function InviteSheet({ room }: { room: RoomView }) {
  const url = inviteUrl(room.roomId);
  const inputRef = useRef<HTMLInputElement>(null);
  const taken = seatsTaken(room);
  const close = () => setUI({ inviteOpen: false });

  const copy = async () => {
    const ok = await copyText(url, inputRef.current);
    toast(ok ? 'success' : 'error', ok ? 'Link copied — paste it in the group chat' : 'Couldn’t copy. Long-press the link to copy it.');
  };

  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: 'Flock Poker', text: INVITE_TEXT, url });
        return;
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return;
      }
    }
    await copy();
  };

  const sms = `sms:?&body=${encodeURIComponent(`${INVITE_TEXT} ${url}`)}`;

  // Inside Messages: put the game bubble in this conversation's compose field (native collapses the
  // extension so the player taps Send). Falls back to the share sheet if native is not listening.
  const embedded = isEmbedded();
  const sendToChat = async () => {
    if (sendInvite(room)) {
      close();
      return;
    }
    await share();
  };

  return (
    <Sheet title="Invite friends" onClose={close}>
      <div className="sheet-body invite">
        <div className="invite-hero">
          <BirdMascot size={64} />
          <div>
            <p className="invite-label">Room code</p>
            <p className="invite-code" data-testid="invite-code" aria-label={`Room code ${room.roomId.split('').join(' ')}`}>
              {room.roomId}
            </p>
          </div>
        </div>
        <p className="invite-seats">
          <b>
            {taken}/{room.settings.maxPlayers}
          </b>{' '}
          seats taken · blinds {formatChips(room.settings.smallBlind)}/{formatChips(room.settings.bigBlind)} · buy-in{' '}
          {formatChips(room.settings.buyIn)}
        </p>
        <div className="invite-link">
          <input ref={inputRef} className="text-input" readOnly value={url} aria-label="Invite link" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-white btn-sm" aria-label="Copy link" onClick={() => void copy()}>
            <IconCopy width={20} height={20} />
          </button>
        </div>
        {embedded ? (
          <button type="button" className="btn btn-green btn-lg btn-block" data-testid="send-to-chat" onClick={() => void sendToChat()}>
            <IconMessage width={22} height={22} /> Send to chat
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-green btn-lg btn-block" data-testid="send-invite" onClick={() => void share()}>
              <IconShare width={22} height={22} /> Send invite
            </button>
            <a className="btn btn-white btn-block" href={sms}>
              <IconMessage width={22} height={22} /> Open Messages
            </a>
          </>
        )}
        <p className="invite-rules">Everyone gets one buy-in. Buy-backs need a unanimous yes.</p>
      </div>
    </Sheet>
  );
}
