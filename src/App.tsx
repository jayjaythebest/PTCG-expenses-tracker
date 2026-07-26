import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ExpenseForm } from './components/ExpenseForm';
import { ExpenseList } from './components/ExpenseList';
import { Dashboard } from './components/Dashboard';
import { Collection } from './components/Collection';
import { Zap, ClipboardList, BarChart2, Star } from 'lucide-react';
import { cn } from './lib/utils';

type Tab = 'record' | 'analysis' | 'collection';

function AppContent() {
  const { loading } = useAuth();
  const [tab, setTab] = useState<Tab>('record');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-poke-accent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink pb-12">
      {/* Header */}
      <header className="bg-surface/80 backdrop-blur border-b border-white/10 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-poke-blue rounded-full flex items-center justify-center shadow-sm">
              <Zap className="w-5 h-5 text-white fill-white" />
            </div>
            <span className="font-black text-xl text-slate-100 tracking-tight">寶可夢支出追蹤</span>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-4xl mx-auto px-4 flex border-t border-white/10">
          <button
            onClick={() => setTab('record')}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-black border-b-2 transition-colors',
              tab === 'record'
                ? 'border-poke-accent text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            )}
          >
            <ClipboardList className="w-4 h-4" />
            記帳
          </button>
          <button
            onClick={() => setTab('analysis')}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-black border-b-2 transition-colors',
              tab === 'analysis'
                ? 'border-poke-accent text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            )}
          >
            <BarChart2 className="w-4 h-4" />
            支出分析
          </button>
          <button
            onClick={() => setTab('collection')}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-black border-b-2 transition-colors',
              tab === 'collection'
                ? 'border-poke-accent text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            )}
          >
            <Star className="w-4 h-4" />
            收藏庫
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {tab === 'record' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            <div className="lg:col-span-2">
              <ExpenseForm />
            </div>
            <div className="lg:col-span-3">
              <ExpenseList />
            </div>
          </div>
        )}

        {tab === 'analysis' && (
          <Dashboard />
        )}

        {tab === 'collection' && (
          <Collection />
        )}
      </main>
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
