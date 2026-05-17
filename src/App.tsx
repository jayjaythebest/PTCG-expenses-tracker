import { useState, useRef, useEffect } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ExpenseList } from './components/ExpenseList';
import { Dashboard } from './components/Dashboard';
import { ExpenseForm } from './components/ExpenseForm';
import { CardScanner } from './components/CardScanner';
import { BarChart2, Plus, List, Camera, Pencil } from 'lucide-react';
import { cn } from './lib/utils';

type Tab = 'dashboard' | 'list';
type Sheet = 'none' | 'form' | 'scanner' | 'menu';

function AppContent() {
  const { loading } = useAuth();
  const [tab, setTab] = useState<Tab>('list');
  const [sheet, setSheet] = useState<Sheet>('none');
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside tap
  useEffect(() => {
    if (sheet !== 'menu') return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSheet('none');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sheet]);

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-notion-bg">
        <div className="h-7 w-7 rounded-full border-2 border-poke-blue border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-notion-bg">
      {/* iOS status-bar safe area */}
      <div className="safe-top shrink-0 bg-notion-bg" />

      {/* Top header */}
      <header className="shrink-0 flex items-center gap-2.5 px-4 h-12 border-b border-notion-border bg-notion-bg">
        <div className="w-7 h-7 rounded-lg bg-poke-blue flex items-center justify-center shrink-0">
          <span className="text-white text-xs font-black select-none">P</span>
        </div>
        <span className="font-semibold text-notion-text text-[17px] leading-none">
          寶可夢支出追蹤
        </span>
      </header>

      {/* Scrollable content */}
      <main className="flex-1 overflow-y-auto overscroll-y-contain">
        {tab === 'dashboard' ? <Dashboard /> : <ExpenseList />}
      </main>

      {/* Bottom navigation */}
      <nav className="shrink-0 border-t border-notion-border bg-notion-bg/95 backdrop-blur-sm relative">
        <div className="flex items-center h-[49px]">
          {/* 概覽 */}
          <button
            onClick={() => { setSheet('none'); setTab('dashboard'); }}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-[3px] h-full transition-colors',
              tab === 'dashboard' && sheet === 'none' ? 'text-poke-blue' : 'text-notion-muted'
            )}
          >
            <BarChart2 className="w-[22px] h-[22px]" />
            <span className="text-[10px] font-medium tracking-tight">概覽</span>
          </button>

          {/* Centre + button with action menu */}
          <div className="flex-1 flex items-center justify-center" ref={menuRef}>
            {/* Floating action menu */}
            {sheet === 'menu' && (
              <div className="absolute bottom-[62px] left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10">
                <button
                  onClick={() => setSheet('scanner')}
                  className="flex items-center gap-2.5 px-5 py-3 bg-white rounded-2xl shadow-xl border border-notion-border text-sm font-semibold text-notion-text whitespace-nowrap active:scale-95 transition-transform"
                >
                  <Camera className="w-4 h-4 text-poke-blue" />
                  掃描卡片
                </button>
                <button
                  onClick={() => setSheet('form')}
                  className="flex items-center gap-2.5 px-5 py-3 bg-white rounded-2xl shadow-xl border border-notion-border text-sm font-semibold text-notion-text whitespace-nowrap active:scale-95 transition-transform"
                >
                  <Pencil className="w-4 h-4 text-notion-muted" />
                  手動輸入
                </button>
              </div>
            )}

            <button
              onClick={() => setSheet(s => s === 'menu' ? 'none' : 'menu')}
              className={cn(
                'w-[52px] h-[52px] rounded-[16px] flex items-center justify-center -mt-6 shadow-lg transition-all active:scale-95',
                sheet === 'menu'
                  ? 'bg-notion-text rotate-45'
                  : 'bg-poke-blue shadow-poke-blue/30'
              )}
            >
              <Plus className="w-6 h-6 text-white" strokeWidth={2.5} />
            </button>
          </div>

          {/* 記錄 */}
          <button
            onClick={() => { setSheet('none'); setTab('list'); }}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-[3px] h-full transition-colors',
              tab === 'list' && sheet === 'none' ? 'text-poke-blue' : 'text-notion-muted'
            )}
          >
            <List className="w-[22px] h-[22px]" />
            <span className="text-[10px] font-medium tracking-tight">記錄</span>
          </button>
        </div>
        <div className="safe-bottom bg-notion-bg" />
      </nav>

      {/* Sheets */}
      {sheet === 'form' && <ExpenseForm onClose={() => setSheet('none')} />}
      {sheet === 'scanner' && <CardScanner onClose={() => setSheet('none')} />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
