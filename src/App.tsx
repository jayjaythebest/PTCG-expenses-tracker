import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ExpenseForm } from './components/ExpenseForm';
import { ExpenseList } from './components/ExpenseList';
import { Dashboard } from './components/Dashboard';
import { Zap, ClipboardList, BarChart2 } from 'lucide-react';
import { cn } from './lib/utils';

type Tab = 'record' | 'analysis';

function AppContent() {
  const { loading } = useAuth();
  const [tab, setTab] = useState<Tab>('record');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-poke-blue"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* Header */}
      <header className="bg-white border-b-2 border-poke-blue/10 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-poke-blue rounded-full flex items-center justify-center shadow-sm">
              <Zap className="w-5 h-5 text-white fill-white" />
            </div>
            <span className="font-black text-xl text-poke-dark-blue tracking-tight">寶可夢支出追蹤</span>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-4xl mx-auto px-4 flex border-t border-slate-100">
          <button
            onClick={() => setTab('record')}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-black border-b-2 transition-colors',
              tab === 'record'
                ? 'border-poke-blue text-poke-dark-blue'
                : 'border-transparent text-slate-400 hover:text-slate-600'
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
                ? 'border-poke-blue text-poke-dark-blue'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            )}
          >
            <BarChart2 className="w-4 h-4" />
            支出分析
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
