/**
 * GitHubService: Módulo para consultar contexto complementario de GitHub
 * (árbol de archivos, interfaces, dependencias y firmas globales).
 */

export class GitHubService {
  constructor(token = process.env.GITHUB_TOKEN) {
    this.token = token;
  }

  /**
   * Extrae owner y repo de varias formas de URL de GitHub.
   * @param {string} repoInput 
   * @returns {{ owner: string, repo: string } | null}
   */
  parseRepo(repoInput) {
    if (!repoInput) return null;
    const clean = repoInput.trim().replace(/\.git$/, '').replace(/\/$/, '');
    
    // Si viene como https://github.com/owner/repo
    const urlMatch = clean.match(/github\.com\/([^\/]+)\/([^\/]+)/i);
    if (urlMatch) {
      return { owner: urlMatch[1], repo: urlMatch[2] };
    }

    // Si viene como owner/repo
    const parts = clean.split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] };
    }

    return null;
  }

  /**
   * Obtiene contexto relevante del repositorio (árbol resumido de archivos y package.json si existe)
   * @param {string} repoInput 
   * @param {string} targetFile 
   * @returns {Promise<{ treeSummary: string[], relevantTypes: string, repoName: string }>}
   */
  async getRepoContext(repoInput, targetFile = '') {
    const parsed = this.parseRepo(repoInput);
    if (!parsed) {
      return { treeSummary: [], relevantTypes: '', repoName: '' };
    }

    const { owner, repo } = parsed;
    const headers = {
      'User-Agent': 'Stateless-Developer-Companion/1.0',
      'Accept': 'application/vnd.github.v3+json'
    };
    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    try {
      // 1. Obtener información del repositorio para rama por defecto
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      if (!repoRes.ok) {
        console.warn(`[GitHubService] Repo ${owner}/${repo} no accesible o rate-limited: HTTP ${repoRes.status}`);
        return { treeSummary: [], relevantTypes: '', repoName: `${owner}/${repo}` };
      }
      const repoData = await repoRes.json();
      const defaultBranch = repoData.default_branch || 'main';

      // 2. Obtener árbol de archivos
      const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`, { headers });
      let treeSummary = [];
      if (treeRes.ok) {
        const treeData = await treeRes.json();
        if (Array.isArray(treeData.tree)) {
          // Filtrar archivos de código relevantes y limitar a 50 rutas para el prompt
          treeSummary = treeData.tree
            .filter(item => item.type === 'blob' && !item.path.startsWith('.') && !item.path.includes('node_modules'))
            .map(item => item.path)
            .slice(0, 60);
        }
      }

      return {
        repoName: `${owner}/${repo}`,
        defaultBranch,
        treeSummary,
        relevantTypes: `Estructura del repositorio (${owner}/${repo}): ${treeSummary.slice(0, 20).join(', ')}`
      };
    } catch (err) {
      console.warn(`[GitHubService] Error al consultar GitHub: ${err.message}`);
      return { treeSummary: [], relevantTypes: '', repoName: `${owner}/${repo}` };
    }
  }
}

export const githubService = new GitHubService();
