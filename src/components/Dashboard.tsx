import { useExpenses } from '../lib/useExpenses';

const CATEGORY_EMOJI: Record<string, string> = {
  Card: '🃏',
  Box: '📦',
  Tournament: '🏆',
};

const CATEGORY_LABEL: Record<string, string> = {
  Card: '單張卡片',
  Box: '整盒/擴充包',
  Tournament: '賽事報名費',
};

function catEmoji(c: string) { return CATEGORY_EMOJI[c] ?? '📌'; }
function catLabel(c: string) { return CATEGORY_LABEL[c] ?? c; }

export function Dashboard() {
  const { expenses } = useExpenses();

  const totalExpense = expenses
    .filter(e => e.type === 'Expense' || !e.type)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const totalIncome = expenses
    .filter(e => e.type === 'Income')
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const balance = totalIncome - totalExpense;

  const byCategory = expenses.reduce((acc, e) => {
    const cat = e.category as string;
    const amt = Number(e.amount) || 0;
    if (!acc[cat]) acc[cat] = { expense: 0, income: 0 };
    if (e.type === 'Income') acc[cat].income += amt;
    else acc[cat].expense += amt;
    return acc;
  }, {} as Record<string, { expense: number; income: number }>);

  const catEntries = Object.entries(byCategory);

  return (
    <div className="pb-8">
      {/* Page title */}
      <div className="px-4 pt-6 pb-5">
        <p className="text-[11px] font-semibold text-notion-muted uppercase tracking-widest mb-1">
          日本留學
        </p>
        <h1 className="text-[28px] font-bold text-notion-text leading-tight">支出概覽</h1>
      </div>

      {/* Balance hero */}
      <div className="mx-4 mb-5 bg-poke-blue rounded-2xl px-5 py-5 text-white">
        <p className="text-blue-200 text-xs font-medium mb-1">目前餘額（日圓）</p>
        <p className="text-[40px] font-bold tracking-tight leading-none">
          {balance >= 0 ? '+' : ''}¥{balance.toLocaleString()}
        </p>
      </div>

      {/* Income / Expense grid */}
      <div className="mx-4 grid grid-cols-2 gap-3 mb-6">
        <div className="bg-notion-bg2 rounded-xl px-4 py-4">
          <p className="text-[11px] text-notion-muted mb-1 font-medium">總收入</p>
          <p className="text-[22px] font-bold text-poke-blue leading-none">
            ¥{totalIncome.toLocaleString()}
          </p>
        </div>
        <div className="bg-notion-bg2 rounded-xl px-4 py-4">
          <p className="text-[11px] text-notion-muted mb-1 font-medium">總支出</p>
          <p className="text-[22px] font-bold text-notion-text leading-none">
            ¥{totalExpense.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Category breakdown */}
      <div className="px-4">
        <p className="text-[11px] font-semibold text-notion-muted uppercase tracking-widest mb-3">
          分類統計
        </p>
        <div className="rounded-xl border border-notion-border overflow-hidden">
          {catEntries.length === 0 ? (
            <div className="py-8 text-center text-sm text-notion-muted">
              尚無數據，快去新增第一筆記錄吧！
            </div>
          ) : (
            catEntries.map(([cat, totals], i) => (
              <div
                key={cat}
                className={`flex items-center px-4 py-3.5 ${i < catEntries.length - 1 ? 'border-b border-notion-border' : ''}`}
              >
                <span className="text-lg mr-3 leading-none">{catEmoji(cat)}</span>
                <span className="flex-1 text-sm text-notion-text">{catLabel(cat)}</span>
                <div className="text-right">
                  {totals.income > 0 && (
                    <p className="text-sm font-semibold text-poke-blue">
                      +¥{totals.income.toLocaleString()}
                    </p>
                  )}
                  {totals.expense > 0 && (
                    <p className="text-sm font-semibold text-notion-muted">
                      −¥{totals.expense.toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick stats footer */}
      {expenses.length > 0 && (
        <p className="text-center text-[11px] text-notion-muted mt-5">
          共 {expenses.length} 筆記錄
        </p>
      )}
    </div>
  );
}
