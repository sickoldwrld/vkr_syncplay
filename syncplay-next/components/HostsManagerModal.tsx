'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRoomSession, type Participant } from '@/lib/roomSession';
import { useToast } from './Toast';

/**
 * Модалка управления хостами комнаты. Открывается только для primary-хоста.
 * Показывает всех участников, помечает HOST-овых и primary, даёт promote / demote.
 *
 * Источник истины — Spring (REST). Обновления приходят через WS HOSTS_UPDATE
 * сразу после успешного запроса, но мы также оптимистично обновляем hostIds
 * в roomSession через session.promoteToHost/demoteHost.
 */
export default function HostsManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useRoomSession();
  const toast = useToast();
  const [list, setList] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await s.loadParticipants();
      setList(data);
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось загрузить участников');
    } finally {
      setLoading(false);
    }
  }, [s, toast]);

  useEffect(() => { if (open) reload(); }, [open, reload]);

  // Подхватываем апдейты hostIds (например, после promote/demote) и пересоберём
  // флаги role/primary локально, чтобы не делать лишний REST-запрос.
  useEffect(() => {
    if (!open || list.length === 0) return;
    setList(prev => prev.map(p => ({
      ...p,
      role: s.hostIds.includes(p.userId) ? 'HOST' : 'LISTENER',
      primary: p.userId === s.primaryHostId,
    })));
  }, [s.hostIds, s.primaryHostId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  async function onPromote(p: Participant) {
    setBusyId(p.userId);
    try {
      await s.promoteToHost(p.userId);
      toast.success(`${p.username ?? p.userId.slice(0, 6)} — теперь хост`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось назначить хоста');
    } finally { setBusyId(null); }
  }

  async function onDemote(p: Participant) {
    setBusyId(p.userId);
    try {
      await s.demoteHost(p.userId);
      toast.info(`${p.username ?? p.userId.slice(0, 6)} — больше не хост`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось снять хоста');
    } finally { setBusyId(null); }
  }

  async function onKick(p: Participant) {
    const label = p.username ?? p.userId.slice(0, 6);
    if (!window.confirm(`Удалить ${label} из комнаты?`)) return;
    setBusyId(p.userId);
    try {
      await s.kickParticipant(p.userId);
      toast.info(`${label} удалён из комнаты`);
      // Drop locally so the row disappears without waiting for a reload.
      setList(prev => prev.filter(x => x.userId !== p.userId));
    } catch (e: any) {
      toast.error(e?.message ?? 'Не удалось удалить участника');
    } finally { setBusyId(null); }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 92vw)', maxHeight: '80vh', overflow: 'auto',
          background: 'oklch(0.16 0.04 280 / 0.98)',
          border: '1px solid var(--glass-border)',
          borderRadius: 16, padding: 18,
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontFamily: "'Space Grotesk', sans-serif", fontSize: 18 }}>Хосты комнаты</h3>
          <button onClick={onClose} className="icon-btn" style={{ background: 'transparent', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer' }}>✕</button>
        </div>

        {loading && <div style={{ color: 'var(--ink-faint)' }}>Загрузка…</div>}
        {!loading && list.length === 0 && <div style={{ color: 'var(--ink-faint)' }}>Нет участников.</div>}

        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {list.map(p => {
            const label = p.username ?? p.userId.slice(0, 6);
            const isHost = p.role === 'HOST';
            return (
              <li
                key={p.userId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 6px',
                  borderTop: '1px solid var(--glass-border)',
                }}
              >
                <span style={{ flex: 1 }}>
                  {label}
                  {p.primary && <span style={badgeStyle('primary')}>владелец</span>}
                  {isHost && !p.primary && <span style={badgeStyle('cohost')}>co-host</span>}
                </span>
                {p.primary ? (
                  <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>—</span>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isHost
                      ? <button onClick={() => onDemote(p)} disabled={busyId === p.userId} style={btnStyle('danger')}>Снять</button>
                      : <button onClick={() => onPromote(p)} disabled={busyId === p.userId} style={btnStyle('primary')}>Назначить</button>}
                    <button
                      onClick={() => onKick(p)}
                      disabled={busyId === p.userId}
                      style={btnStyle('danger')}
                      title="Удалить участника из комнаты"
                    >Выгнать</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <p style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 12 }}>
          Co-host может управлять воспроизведением (Play/Pause/Skip/Seek). Снять владельца нельзя.
        </p>
      </div>
    </div>
  );
}

function badgeStyle(variant: 'primary' | 'cohost'): React.CSSProperties {
  return {
    marginLeft: 8,
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 6,
    background: variant === 'primary' ? 'oklch(0.6 0.18 280)' : 'oklch(0.5 0.12 200)',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
}

function btnStyle(variant: 'primary' | 'danger'): React.CSSProperties {
  return {
    appearance: 'none',
    border: '1px solid var(--glass-border)',
    background: variant === 'danger' ? 'oklch(0.4 0.12 30)' : 'oklch(0.4 0.12 280)',
    color: '#fff',
    padding: '6px 12px',
    borderRadius: 8,
    fontSize: 12,
    cursor: 'pointer',
  };
}
