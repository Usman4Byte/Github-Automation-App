import React, { useState, useEffect, useCallback } from 'react';
import { 
  Activity, 
  GitBranch, 
  Settings, 
  Play, 
  Square, 
  Calendar, 
  Clock, 
  LogOut, 
  CheckCircle2, 
  AlertCircle,
  History,
  TerminalSquare,
  Loader2,
  RefreshCw,
  Info
} from 'lucide-react';

// Fallback GitHub SVG icon component
const GithubIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.186 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.157-1.11-1.465-1.11-1.465-.908-.62.069-.608.069-.608 1.004.07 1.532 1.032 1.532 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.339-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.025A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.295 2.748-1.025 2.748-1.025.546 1.378.202 2.397.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.847-2.337 4.695-4.566 4.944.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.749 0 .268.18.579.688.481C19.138 20.203 22 16.447 22 12.021 22 6.484 17.523 2 12 2z" />
  </svg>
);
// --- GitHub API Utilities ---
const GITHUB_API = 'https://api.github.com';

const ghFetch = async (endpoint, token, options = {}) => {
  // DEV BYPASS: Prevent real API calls if using the dev token
  if (token === 'dev-token-bypass') {
    if (endpoint === '/user') return DEV_USER;
    if (endpoint.includes('/user/repos')) return DEV_REPOS;
    return null;
  }

  const res = await fetch(`${GITHUB_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      ...options.headers,
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API Error: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
};

const getWorkflowFile = async (token, owner, repo) => {
  if (token === 'dev-token-bypass') return repo === 'demo-repo-1' ? { sha: 'mock-sha-123' } : null;

  try {
    const data = await ghFetch(`/repos/${owner}/${repo}/contents/.github/workflows/autocommit.yml`, token);
    return data;
  } catch (e) {
    return null; // File doesn't exist
  }
};

const injectWorkflow = async (token, owner, repo, config, existingSha = null) => {
  if (token === 'dev-token-bypass') return Promise.resolve(); // Mock success

  const cronSchedule = config.weekendMode === 'none' ? '0 * * * 1-5' : '0 * * * *';
  
  // Create a robust bash script inside the action to handle randomizations
  const yamlContent = `name: AutoCommit Bot
on:
  schedule:
    - cron: '${cronSchedule}'
  workflow_dispatch:

jobs:
  auto-commit:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v3
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
          
      - name: AutoCommit Logic
        run: |
          CURRENT_HOUR=$(date +%H)
          START_HOUR=${config.startHour}
          END_HOUR=${config.endHour}
          
          # Check active hours
          if [ "$CURRENT_HOUR" -lt "$START_HOUR" ] || [ "$CURRENT_HOUR" -gt "$END_HOUR" ]; then
            echo "Outside active hours. Skipping."
            exit 0
          fi
          
          # Check skip chance
          SKIP_CHANCE=${config.skipChance}
          RAND=$(($RANDOM % 100))
          if [ "$RAND" -lt "$SKIP_CHANCE" ]; then
            echo "Random skip triggered. Skipping."
            exit 0
          fi
          
          # Setup Git
          git config --global user.name "github-actions[bot]"
          git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
          
          # Perform empty commit
          git commit --allow-empty -m "${config.defaultMessage || 'Automated commit'}"
          git push
`;

  const contentEncoded = btoa(unescape(encodeURIComponent(yamlContent)));

  await ghFetch(`/repos/${owner}/${repo}/contents/.github/workflows/autocommit.yml`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message: '🤖 Configure AutoCommit Bot',
      content: contentEncoded,
      sha: existingSha || undefined
    })
  });
};

const deleteWorkflow = async (token, owner, repo, sha) => {
  if (token === 'dev-token-bypass') return Promise.resolve(); // Mock success
  
  await ghFetch(`/repos/${owner}/${repo}/contents/.github/workflows/autocommit.yml`, token, {
    method: 'DELETE',
    body: JSON.stringify({
      message: '🛑 Stop AutoCommit Bot',
      sha: sha
    })
  });
};

// Backfill using the Git Database API to spoof commit dates
const performBackfill = async (token, owner, repo, date, branch) => {
  if (token === 'dev-token-bypass') return Promise.resolve(); // Mock success

  // 1. Get current branch reference
  const ref = await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token);
  const latestCommitSha = ref.object.sha;

  // 2. Get the commit to find its tree
  const commit = await ghFetch(`/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, token);
  const treeSha = commit.tree.sha;

  // 3. Create a new commit with the spoofed date
  const spoofedDate = new Date(date).toISOString();
  const newCommit = await ghFetch(`/repos/${owner}/${repo}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({
      message: `Historical backfill commit for ${date}`,
      tree: treeSha,
      parents: [latestCommitSha],
      author: {
        name: "AutoCommit Bot",
        email: "bot@autocommit.local",
        date: spoofedDate
      },
      committer: {
        name: "AutoCommit Bot",
        email: "bot@autocommit.local",
        date: spoofedDate
      }
    })
  });

  // 4. Update the branch reference to point to the new commit
  await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      sha: newCommit.sha
    })
  });
};


// --- MOCK DEV DATA ---
const DEV_USER = {
  login: 'dev_hacker',
  name: 'Dev Mode User',
  avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=dev',
  id: 9999999,
  html_url: 'https://github.com'
};

const DEV_REPOS = [
  { id: 101, name: 'demo-repo-1', owner: { login: 'dev_hacker' }, default_branch: 'main', private: false },
  { id: 102, name: 'super-secret-backend', owner: { login: 'dev_hacker' }, default_branch: 'master', private: true },
  { id: 103, name: 'personal-portfolio', owner: { login: 'dev_hacker' }, default_branch: 'main', private: false }
];

// --- Main Application ---
export default function App() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [repos, setRepos] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [toast, setToast] = useState(null);
  
  // UI State
  const [isLoading, setIsLoading] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [logs, setLogs] = useState([]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const addLog = (action, repoName, status = 'success') => {
    setLogs(prev => [{ id: Date.now(), action, repo: repoName, status, time: 'Just now' }, ...prev].slice(0, 10));
  };

  const handleLogin = async (inputToken) => {
    setIsLoading(true);
    try {
      const userData = await ghFetch('/user', inputToken);
      setUser(userData);
      setToken(inputToken);
      showToast(`Welcome back, ${userData.login}!`);
      fetchRepos(inputToken, userData.login);
    } catch (err) {
      showToast("Invalid token or missing permissions.", 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDevBypass = () => {
    setIsLoading(true);
    setTimeout(() => {
      setUser(DEV_USER);
      setToken('dev-token-bypass');
      
      const enrichedRepos = DEV_REPOS.map(r => ({
        id: r.id,
        name: r.name,
        owner: r.owner.login,
        default_branch: r.default_branch,
        private: r.private,
        status: r.name === 'demo-repo-1' ? 'active' : 'paused', 
        workflowSha: r.name === 'demo-repo-1' ? 'mock-sha' : null
      }));
      
      setRepos(enrichedRepos);
      showToast('Bypassed Authentication (Dev Mode)', 'success');
      setIsLoading(false);
    }, 600);
  };

  const fetchRepos = async (authToken, username) => {
    if (authToken === 'dev-token-bypass') return; // Handled in handleDevBypass

    setIsLoading(true);
    try {
      // Fetch user's repos
      const reposData = await ghFetch(`/user/repos?sort=updated&per_page=15`, authToken);
      
      const enrichedRepos = reposData.map(r => ({
        id: r.id,
        name: r.name,
        owner: r.owner.login,
        default_branch: r.default_branch,
        private: r.private,
        status: 'checking...', 
        workflowSha: null
      }));
      setRepos(enrichedRepos);

      // Check workflow status for each repo in the background
      enrichRepoStatuses(authToken, enrichedRepos);
    } catch (err) {
      showToast("Failed to fetch repositories", 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const enrichRepoStatuses = async (authToken, reposList) => {
    for (const repo of reposList) {
      try {
        const file = await getWorkflowFile(authToken, repo.owner, repo.name);
        setRepos(prev => prev.map(r => 
          r.id === repo.id 
            ? { ...r, status: file ? 'active' : 'paused', workflowSha: file ? file.sha : null } 
            : r
        ));
      } catch (e) {
        setRepos(prev => prev.map(r => r.id === repo.id ? { ...r, status: 'paused' } : r));
      }
    }
  };

  const toggleRepoStatus = async (repo) => {
    setIsLoading(true);
    try {
      if (repo.status === 'active') {
        // Stop automation
        await deleteWorkflow(token, repo.owner, repo.name, repo.workflowSha);
        setRepos(prev => prev.map(r => r.id === repo.id ? { ...r, status: 'paused', workflowSha: null } : r));
        showToast(`${repo.name} automation paused`);
        addLog("Removed workflow action", repo.name, "warning");
      } else {
        // Direct start with defaults
        openConfig(repo);
      }
    } catch (err) {
      showToast(`Action failed: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const saveConfigAndInject = async (repo, config) => {
    setIsLoading(true);
    setShowConfigModal(false);
    try {
      await injectWorkflow(token, repo.owner, repo.name, config, repo.workflowSha);
      showToast(`Workflow successfully injected into ${repo.name}`);
      addLog("Injected automation workflow", repo.name, "success");
      
      // Refresh repo status (simulate file exists now if dev mode)
      const fileSha = token === 'dev-token-bypass' ? 'mock-new-sha' : (await getWorkflowFile(token, repo.owner, repo.name))?.sha;
      setRepos(prev => prev.map(r => 
        r.id === repo.id ? { ...r, status: 'active', workflowSha: fileSha } : r
      ));
    } catch (err) {
      showToast(`Failed to inject: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const executeBackfill = async (repoId, startDate, endDate, density) => {
    const repo = repos.find(r => r.id.toString() === repoId);
    if (!repo) return showToast("Invalid repo", "error");
    
    setIsLoading(true);
    try {
      // Create a small batch of commits based on start date for demonstration
      // In a real production app, you'd queue this on a backend due to rate limits.
      const date = new Date(startDate);
      const commitsToMake = Math.min(parseInt(density), 5); // Cap at 5 for browser safety
      
      for(let i=0; i<commitsToMake; i++) {
        await performBackfill(token, repo.owner, repo.name, date.toISOString(), repo.default_branch);
        date.setHours(date.getHours() + 2); // space them out
      }
      
      showToast(`Successfully backfilled ${commitsToMake} commits in ${repo.name}`);
      addLog(`Backfilled ${commitsToMake} commits`, repo.name, "success");
    } catch (err) {
      showToast(`Backfill failed: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const openConfig = (repo) => {
    setSelectedRepo(repo);
    setShowConfigModal(true);
  };

  if (!user) {
    return <LoginScreen onLogin={handleLogin} onDevBypass={handleDevBypass} isLoading={isLoading} />;
  }

  const activeAutomations = repos.filter(r => r.status === 'active').length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col hidden md:flex">
        <div className="p-6 flex items-center gap-3 border-b border-gray-800">
          <TerminalSquare className="w-8 h-8 text-green-500" />
          <span className="font-bold text-xl tracking-tight">AutoCommit</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <SidebarItem icon={Activity} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <SidebarItem icon={GitBranch} label="Repositories" active={activeTab === 'repos'} onClick={() => setActiveTab('repos')} />
          <SidebarItem icon={History} label="Backfill Engine" active={activeTab === 'backfill'} onClick={() => setActiveTab('backfill')} />
          <SidebarItem icon={Settings} label="Global Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>

        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3 mb-4">
            <img src={user.avatar_url} alt="Avatar" className="w-10 h-10 rounded-full bg-gray-800 border border-gray-700" />
            <div className="overflow-hidden">
              <p className="text-sm font-medium truncate">{user.name || user.login}</p>
              <p className="text-xs text-gray-400 truncate">@{user.login}</p>
            </div>
          </div>
          <button 
            onClick={() => {setUser(null); setToken('');}}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-400 transition-colors w-full p-2 rounded-md hover:bg-gray-800"
          >
            <LogOut className="w-4 h-4" /> Disconnect
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative">
        {isLoading && (
          <div className="absolute top-0 left-0 w-full h-1 bg-gray-800 overflow-hidden z-50">
            <div className="h-full bg-green-500 w-1/3 animate-pulse transition-all duration-500"></div>
          </div>
        )}

        {token === 'dev-token-bypass' && (
          <div className="bg-yellow-500/20 text-yellow-500 text-xs font-bold px-4 py-1.5 text-center uppercase tracking-widest sticky top-0 z-40 backdrop-blur-sm border-b border-yellow-500/20">
            Developer Mode Active - Mock Data Only
          </div>
        )}

        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8">
          {activeTab === 'dashboard' && <DashboardView stats={{ activeAutomations, totalRepos: repos.length }} logs={logs} />}
          {activeTab === 'repos' && <RepositoriesView repos={repos} toggleStatus={toggleRepoStatus} openConfig={openConfig} onRefresh={() => fetchRepos(token, user.login)} />}
          {activeTab === 'backfill' && <BackfillView repos={repos} executeBackfill={executeBackfill} isLoading={isLoading} />}
          {activeTab === 'settings' && <GlobalSettingsView user={user} showToast={showToast} />}
        </div>
      </main>

      {/* Modals & Toasts */}
      {showConfigModal && <RepoConfigModal repo={selectedRepo} onClose={() => setShowConfigModal(false)} onSave={saveConfigAndInject} />}
      
      {toast && (
        <div className="fixed bottom-4 right-4 bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 z-50">
          {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <AlertCircle className="w-5 h-5 text-red-500" />}
          <p className="text-sm font-medium">{toast.message}</p>
        </div>
      )}
    </div>
  );
}

// --- Views & Components ---

function LoginScreen({ onLogin, onDevBypass, isLoading }) {
  const [tokenInput, setTokenInput] = useState('');

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-green-500/10 rounded-full blur-3xl pointer-events-none"></div>
      
      <div className="bg-gray-900 border border-gray-800 p-8 md:p-12 rounded-2xl shadow-2xl max-w-md w-full text-center z-10 relative">
        <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner border border-gray-700">
          <TerminalSquare className="w-8 h-8 text-green-500" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">AutoCommit SaaS</h1>
        <p className="text-gray-400 mb-8 text-sm">Automate your GitHub activity graph intelligently.</p>
        
        <div className="space-y-4 text-left">
          <div>
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 block">Personal Access Token</label>
            <input 
              type="password" 
              placeholder="ghp_xxxxxxxxxxxx" 
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none text-white transition-all"
            />
          </div>
          
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex gap-3 text-blue-400 text-xs">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <p>For this fully-functional client environment, generate a Classic PAT from GitHub Developer Settings with <strong>repo</strong> and <strong>workflow</strong> scopes.</p>
          </div>

          <button 
            onClick={() => onLogin(tokenInput)}
            disabled={!tokenInput || isLoading}
            className="w-full bg-white text-black hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-3 transition-all transform active:scale-[0.98]"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <GithubIcon className="w-5 h-5" />}
            Connect to GitHub
          </button>

          <div className="relative py-2 mt-4 mb-2">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-800"></div></div>
            <div className="relative flex justify-center"><span className="bg-gray-900 px-2 text-xs text-gray-500">OR</span></div>
          </div>

          <button 
            onClick={onDevBypass}
            disabled={isLoading}
            className="w-full bg-transparent border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-3 transition-all transform active:scale-[0.98]"
          >
            Bypass Auth (Dev Mode)
          </button>
        </div>
      </div>
    </div>
  );
}

function SidebarItem({ icon: Icon, label, active, onClick }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-green-500/10 text-green-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
      }`}
    >
      <Icon className="w-5 h-5" />
      {label}
    </button>
  );
}

function DashboardView({ stats, logs }) {
  // Generate visual representation
  const graphData = Array.from({ length: 180 }).map(() => {
    const r = Math.random();
    if (r > 0.8) return 4;
    if (r > 0.6) return 3;
    if (r > 0.4) return 2;
    if (r > 0.2) return 1;
    return 0;
  });

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
      <div>
        <h2 className="text-2xl font-bold mb-1">Overview</h2>
        <p className="text-gray-400 text-sm">Real-time status of your GitHub automation workflows.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard title="Active Automations" value={stats.activeAutomations} subtitle={`Across ${stats.totalRepos} loaded repos`} />
        <StatCard title="Bot Status" value="Online" subtitle="System Connected" valueColor="text-green-500" />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 overflow-hidden">
        <h3 className="font-semibold mb-4 text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-green-500" /> Simulated Growth Activity
        </h3>
        <div className="w-full overflow-x-auto pb-2">
          <div className="inline-grid grid-rows-7 grid-flow-col gap-1 w-max">
            {graphData.map((level, i) => (
              <div 
                key={i} 
                className={`w-3 h-3 rounded-sm ${
                  level === 0 ? 'bg-gray-800' : 
                  level === 1 ? 'bg-green-950' : 
                  level === 2 ? 'bg-green-800' : 
                  level === 3 ? 'bg-green-600' : 'bg-green-400'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800">
          <h3 className="font-semibold text-sm">Session Activity Logs</h3>
        </div>
        <div className="divide-y divide-gray-800">
          {logs.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No activity recorded in this session yet.</div>
          ) : logs.map(log => (
            <div key={log.id} className="p-4 flex items-center justify-between hover:bg-gray-800/50 transition-colors">
              <div className="flex items-center gap-3">
                {log.status === 'success' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <AlertCircle className="w-4 h-4 text-yellow-500" />}
                <div>
                  <p className="text-sm font-medium">{log.action}</p>
                  <p className="text-xs text-gray-500">{log.repo}</p>
                </div>
              </div>
              <span className="text-xs text-gray-500">{log.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, valueColor = "text-white" }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-sm text-gray-400 mb-1">{title}</p>
      <p className={`text-3xl font-bold mb-1 ${valueColor}`}>{value}</p>
      <p className="text-xs text-gray-500">{subtitle}</p>
    </div>
  );
}

function RepositoriesView({ repos, toggleStatus, openConfig, onRefresh }) {
  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-1">Your Repositories</h2>
          <p className="text-gray-400 text-sm">Select repos to inject the AutoCommit GitHub Action.</p>
        </div>
        <button onClick={onRefresh} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors w-fit">
          <RefreshCw className="w-4 h-4" /> Refresh List
        </button>
      </div>

      <div className="grid gap-4">
        {repos.map(repo => (
          <div key={repo.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:border-gray-700">
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${repo.status === 'active' ? 'bg-green-500/10' : 'bg-gray-800'}`}>
                <GitBranch className={`w-5 h-5 ${repo.status === 'active' ? 'text-green-500' : 'text-gray-400'}`} />
              </div>
              <div className="overflow-hidden">
                <h3 className="font-semibold flex items-center gap-2 truncate">
                  {repo.name}
                  {repo.private && <span className="px-2 py-0.5 rounded text-gray-400 bg-gray-800 text-[10px] font-bold uppercase tracking-wider">Private</span>}
                  {repo.status === 'active' && <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-[10px] font-bold uppercase tracking-wider">Active</span>}
                  {repo.status === 'paused' && <span className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 text-[10px] font-bold uppercase tracking-wider">Paused</span>}
                  {repo.status === 'checking...' && <Loader2 className="w-3 h-3 text-gray-500 animate-spin" />}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  Default branch: {repo.default_branch}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button 
                onClick={() => openConfig(repo)}
                disabled={repo.status === 'checking...'}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors border border-transparent hover:border-gray-700 disabled:opacity-50"
              >
                <Settings className="w-4 h-4" />
              </button>
              
              <button 
                onClick={() => toggleStatus(repo)}
                disabled={repo.status === 'checking...'}
                className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 min-w-[100px] ${
                  repo.status === 'active' 
                    ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' 
                    : 'bg-green-500/10 text-green-500 hover:bg-green-500/20'
                }`}
              >
                {repo.status === 'active' ? (
                  <><Square className="w-4 h-4 fill-current" /> Stop</>
                ) : (
                  <><Play className="w-4 h-4 fill-current" /> Inject Action</>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BackfillView({ repos, executeBackfill, isLoading }) {
  const [repoId, setRepoId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [density, setDensity] = useState(2);

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
      <div>
        <h2 className="text-2xl font-bold mb-1">Live Backfill Engine</h2>
        <p className="text-gray-400 text-sm">Directly pushes historical commits to your repo via GitHub Git Database API.</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-2xl">
        <form className="space-y-6" onSubmit={(e) => {
          e.preventDefault();
          executeBackfill(repoId, startDate, null, density);
        }}>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Target Repository</label>
            <select 
              required
              value={repoId}
              onChange={e => setRepoId(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm focus:border-green-500 outline-none transition-all text-white">
              <option value="" disabled>Select a repository</option>
              {repos.map(r => <option key={r.id} value={r.id}>{r.name} ({r.default_branch})</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Target Date</label>
            <div className="relative">
              <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input 
                required
                type="date" 
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg p-3 pl-10 text-sm focus:border-green-500 outline-none text-white [color-scheme:dark]" 
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300 flex justify-between">
              <span>Commits to generate (Max 5 for UI safety)</span>
              <span className="text-green-500 font-bold">{density}</span>
            </label>
            <input 
              type="range" 
              min="1" 
              max="5" 
              value={density}
              onChange={e => setDensity(e.target.value)}
              className="w-full accent-green-500 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer" 
            />
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex gap-3 text-yellow-500/90 text-sm mt-4">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p><strong>Warning:</strong> This uses live API calls to modify the Git tree. It will immediately push commits visible on your contribution graph. Use responsibly.</p>
          </div>

          <button 
            type="submit" 
            disabled={isLoading || !repoId || !startDate}
            className="w-full bg-white text-black hover:bg-gray-200 disabled:opacity-50 font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <History className="w-5 h-5" />} 
            Execute Live Backfill
          </button>
        </form>
      </div>
    </div>
  );
}

function GlobalSettingsView({ user, showToast }) {
  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold mb-1">Account Info</h2>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-6">
        <div>
          <h3 className="text-lg font-medium mb-4 pb-2 border-b border-gray-800">GitHub Connection Profile</h3>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img src={user.avatar_url} className="w-12 h-12 rounded-full border border-gray-700" alt="avatar" />
              <div>
                <p className="font-medium">{user.name}</p>
                <p className="text-sm text-gray-500">Connected as @{user.login} • ID: {user.id}</p>
              </div>
            </div>
            <a href={user.html_url} target="_blank" rel="noreferrer" className="text-sm text-gray-400 hover:text-white font-medium px-4 py-2 border border-gray-700 rounded-lg bg-gray-800 transition-colors">View Profile</a>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-800">
           <p className="text-sm text-gray-500">All configurations are saved securely and injected directly into your repositories as GitHub Actions workflow files.</p>
        </div>
      </div>
    </div>
  );
}

function RepoConfigModal({ repo, onClose, onSave }) {
  const [config, setConfig] = useState({
    startHour: 9,
    endHour: 23,
    weekendMode: 'light',
    skipChance: 15,
    defaultMessage: 'Automated maintenance commit'
  });

  if (!repo) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-800 flex items-center justify-between shrink-0 bg-gray-900 z-10">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Settings className="w-5 h-5 text-gray-400" /> Configure & Inject Action
            </h2>
            <p className="text-sm text-gray-500 mt-1">Target: {repo.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-2">✕</button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-300">Active Hours (24h format)</label>
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input 
                  type="number" min="0" max="23" value={config.startHour} onChange={e => setConfig({...config, startHour: e.target.value})}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 pl-10 text-sm focus:border-green-500 outline-none text-white text-center" 
                />
              </div>
              <span className="text-gray-500">to</span>
              <div className="relative flex-1">
                <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input 
                  type="number" min="0" max="23" value={config.endHour} onChange={e => setConfig({...config, endHour: e.target.value})}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 pl-10 text-sm focus:border-green-500 outline-none text-white text-center" 
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-300">Weekend Behavior</label>
            <select 
              value={config.weekendMode} onChange={e => setConfig({...config, weekendMode: e.target.value})}
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm focus:border-green-500 outline-none text-white">
              <option value="normal">Normal (Run everyday)</option>
              <option value="none">Skip weekends entirely (Mon-Fri only)</option>
            </select>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-300 flex justify-between">
              <span>Hourly Skip Probability</span>
              <span className="text-green-500">{config.skipChance}%</span>
            </label>
            <input 
              type="range" min="0" max="90" value={config.skipChance} onChange={e => setConfig({...config, skipChance: e.target.value})}
              className="w-full accent-green-500 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer" 
            />
            <p className="text-xs text-gray-500">Chance that the action will purposely do nothing when triggered, to mimic human inconsistency.</p>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-300">Commit Message</label>
            <input 
              type="text" value={config.defaultMessage} onChange={e => setConfig({...config, defaultMessage: e.target.value})}
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm focus:border-green-500 outline-none text-white" 
            />
          </div>

        </div>

        <div className="p-6 border-t border-gray-800 bg-gray-900 shrink-0 flex gap-3 justify-end z-10">
          <button 
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={() => onSave(repo, config)}
            className="bg-green-600 hover:bg-green-500 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-green-900/20"
          >
            Inject Action Workflow
          </button>
        </div>
      </div>
    </div>
  );
}