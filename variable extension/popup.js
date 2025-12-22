document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('variable-list');
  const loading = document.getElementById('loading');
  const errorDiv = document.getElementById('error');

  async function fetchGTMData() {
    loading.style.display = 'block';
    errorDiv.textContent = '';
    container.innerHTML = '';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found');

      // Extract ONLY User-Defined Variables from GTM page
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
        let reference = '/references';
          const vars = Array.from(
            document.querySelectorAll('a.fill-cell.wd-variable-name.md-gtm-theme')
          )
            .filter(el => {
              const table = el.closest('[data-table-id]');
              return (
                table?.getAttribute('data-table-id') ===
                'variable-list-user-defined'
              );
            })
            .map(el => ({
              name: el.textContent.trim(),
              url: 'https://tagmanager.google.com/api/accounts' + el.href.split('accounts')[1] + reference
            }));

          if (!vars.length) {
            return { error: 'No User-Defined Variables found. Open GTM Variables page.' };
          }

          return { variables: vars };
        }
      });

      if (result?.error) throw new Error(result.error);

      // Fetch variable references
      const variables = await Promise.all(
        result.variables.map(async v => {
          try {
            const res = await fetch(v.url, { credentials: 'include' });
            const raw = await res.text();
            const clean = raw.replace(/^\)\]\}',?\n/, '');
            const parsed = JSON.parse(clean);

            return {
              variableName: v.name,
              entities: parsed?.default?.entity || []
            };
          } catch {
            return { variableName: v.name, entities: [] };
          }
        })
      );

      // Build table
      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Variable Name', 'Tags', 'Triggers'].forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        th.style.border = '1px solid #ccc';
        th.style.padding = '6px';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');

      variables.forEach(v => {
        const tags = v.entities
          .filter(e => 'tagKey' in e)
          .map(e => e.name || e.publicId);

        const triggers = v.entities
          .filter(e => 'triggerKey' in e)
          .map(e => e.name || e.publicId);

        const tr = document.createElement('tr');

        [v.variableName, tags.join(', ') || ' ', triggers.join(', ') || ' ']
          .forEach(text => {
            const td = document.createElement('td');
            td.textContent = text;
            td.style.border = '1px solid #ccc';
            td.style.padding = '6px';
            tr.appendChild(td);
          });

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      container.appendChild(table);
      loading.style.display = 'none';

    } catch (err) {
      loading.style.display = 'none';
      errorDiv.textContent = err.message;
      console.error(err);
    }
  }

  fetchGTMData();
});
