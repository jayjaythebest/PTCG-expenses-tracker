import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ExpenseForm } from './components/ExpenseForm';
import { ExpenseList } from './components/ExpenseList';
import { Dashboard } from './components/Dashboard';
import { Collection } from './components/Collection';
import { Home } from './components/Home';
import { Login } from './components/Login';
import { Zap, Home as HomeIcon, ClipboardList, BarChart2, Star, LogOut } from 'lucide-react';
import { cn } from './lib/utils';

type Tab = 'home' | 'record' | 'analysis' | 'collection';

const TABS: { id: Tab; label: string; icon: typeof HomeIcon }[] = [
  { id: 'home', label: '首頁', icon: HomeIcon },
  { id: 'record', label: '記帳', icon: ClipboardList },
  { id: 'analysis', label: '支出分析', icon: BarChart2 },
  { id: 'collection', label: '收藏庫', icon: Star },
];

function AppContent() {
  const { profile, loading, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>('home');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-poke-accent"></div>
      </div>
    );
  }

  if (!profile) {
    return <Login />;
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
            <span className="font-black text-xl text-slate-100 tracking-tight">J Vault</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400 hidden sm:inline">{profile.displayName}</span>
            <button
              onClick={signOut}
              title="登出"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-4xl mx-auto px-4 flex border-t border-white/10 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-black border-b-2 transition-colors whitespace-nowrap',
                tab === id
                  ? 'border-poke-accent text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {tab === 'home' && (
          <Home onNavigate={setTab} />
        )}

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
