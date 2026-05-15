'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/Icons';
import { getMe } from '@/lib/api';
import UploadButton from '@/components/UploadButton';

export default function UploadPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await getMe();
      if (!me) { router.replace('/login'); return; }
      setAuthed(true);
    })();
  }, [router]);

  if (!authed) return null;

  return (
    <div className="app">
      <div style={{ position: 'relative', zIndex: 10, padding: '24px 20px', maxWidth: 540, margin: '0 auto' }}>
        <Link href="/" style={{
          color: 'var(--ink-dim)', textDecoration: 'none', fontSize: 13,
          display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 16,
        }}>
          <Icon.ChevronLeft size={14} /> На главную
        </Link>

        <h1 style={{ fontSize: 28, fontWeight: 500, margin: '0 0 8px' }}>
          Загрузить трек
        </h1>
        <p style={{ color: 'var(--ink-dim)', fontSize: 14, marginBottom: 24 }}>
          Метаданные и обложка автоматически берутся из ID3-тегов файла. Загрузка стартует сразу после выбора.
        </p>

        <div className="glass" style={{ padding: 28, borderRadius: 16 }}>
          <UploadButton variant="dropzone" />
        </div>
      </div>
    </div>
  );
}
