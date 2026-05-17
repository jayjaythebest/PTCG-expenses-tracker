import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ExpenseList } from './components/ExpenseList';
import { Dashboard } from './components/Dashboard';
import { ExpenseForm } from './components/ExpenseForm';
import { BarChart2, Plus, List } from 'lucide-react';
import { cn } from './lib/utils';

type Tab = 'dashboard' | 'list';

function AppContent() {
  const { loading } = useAuth();
  const [tab, setTab] = useState<Tab>('list');
  const [showForm, setShowForm] = useState(false);

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
      <nav className="shrink-0 border-t border-notion-border bg-notion-bg/95 backdrop-blur-sm">
        <div className="flex items-center h-[49px]">
          {/* 概覽 */}
          <button
            onClick={() => setTab('dashboard')}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-[3px] h-full transition-colors',
              tab === 'dashboard' ? 'text-poke-blue' : 'text-notion-muted'
            )}
          >
            <BarChart2 className="w-[22px] h-[22px]" />
            <span className="text-[10px] font-medium tracking-tight">概覽</span>
          </button>

          {/* Centre add button — floats up */}
          <div className="flex-1 flex items-center justify-center">
            <button
              onClick={() => setShowForm(true)}
              className="w-[52px] h-[52px] rounded-[16px] bg-poke-blue shadow-lg shadow-poke-blue/30 flex items-center justify-center -mt-6 active:scale-95 transition-transform"
            >
              <Plus className="w-6 h-6 text-white" strokeWidth={2.5} />
            </button>
          </div>

          {/* 記錄 */}
          <button
            onClick={() => setTab('list')}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-[3px] h-full transition-colors',
              tab === 'list' ? 'text-poke-blue' : 'text-notion-muted'
            )}
          >
            <List className="w-[22px] h-[22px]" />
            <span className="text-[10px] font-medium tracking-tight">記錄</span>
          </button>
        </div>
        <div className="safe-bottom bg-notion-bg" />
      </nav>

      {/* Add expense bottom sheet */}
      {showForm && <ExpenseForm onClose={() => setShowForm(false)} />}
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
