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

      // Execute inside GTM page
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const rows = Array.from(
            document.querySelectorAll('[data-table-id="variable-list-user-defined"] tr')
          );

          const variables = [];

          rows.forEach(row => {
            const nameEl = row.querySelector('a.fill-cell.wd-variable-name.md-gtm-theme');
            if (!nameEl) return;

            const variableName = nameEl.innerText.trim();
            const variableType = row.children[2]?.innerText.trim() || ' ';

            variables.push({
              name: variableName,
              type: variableType,
              url: 'https://tagmanager.google.com/api/accounts' + nameEl.href.split('accounts')[1] + '/references'
            });
          });

          if (!variables.length) {
            return { error: 'No User-Defined Variables found.' };
          }

          return { variables };
        }
      });

      if (result?.error) throw new Error(result.error);

      // Fetch references
      const variablesData = await Promise.all(
        result.variables.map(async v => {
          try {
            const res = await fetch(v.url, { credentials: 'include' });
            const raw = await res.text();
            const clean = raw.replace(/^\)\]\}',?\n/, '');
            const parsed = JSON.parse(clean);

            return {
              variableName: v.name,
              variableType: v.type || ' ',
              entities: parsed?.default?.entity || []
            };
          } catch {
            return { variableName: v.name, variableType: v.type || ' ', entities: [] };
          }
        })
      );

      // Build table
      const table = document.createElement('table');
      table.style.width = '100%';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');

      ['Variable Name', 'Variable Type', 'Tags', 'Triggers', 'Variables'].forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        th.style.border = '1px solid #ccc';
        th.style.padding = '6px';
        headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');

      variablesData.forEach(v => {
        const tags = v.entities
          .filter(e => 'tagKey' in e)
          .map(e => e.name || e.publicId)
          .join(', ') || ' ';

        const triggers = v.entities
          .filter(e => 'triggerKey' in e)
          .map(e => e.name || e.publicId)
          .join(', ') || ' ';

        const linkedVariables = v.entities
          .filter(e => 'variableKey' in e)
          .map(e => e.name || e.publicId)
          .join(', ') || ' ';

        const tr = document.createElement('tr');

        [v.variableName, v.variableType, tags, triggers, linkedVariables].forEach(text => {
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

      // CSV Export Button ---
      const exportBtn = document.createElement('button');
      exportBtn.textContent = 'Export CSV';
      exportBtn.style.margin = '10px 0';
      exportBtn.style.padding = '6px 12px';
      exportBtn.style.cursor = 'pointer';
      container.prepend(exportBtn);

      exportBtn.addEventListener('click', () => {
        const rows = Array.from(container.querySelectorAll('table tr'));
        const csvContent = rows.map(row => {
          const cells = Array.from(row.querySelectorAll('td, th'));
          return cells.map(cell => `"${cell.textContent.replace(/"/g, '""')}"`).join(',');
        }).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'gtm_variables.csv';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });

      // Add checkboxes + storage + GTM sync
      tbody.querySelectorAll('tr').forEach(row => {
        const firstCell = row.querySelector('td');
        if (!firstCell || firstCell.querySelector('.custom-variable-checkbox')) return;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'custom-variable-checkbox';
        checkbox.style.marginRight = '8px';

        const wrapper = document.createElement('span');
        wrapper.style.display = 'inline-flex';
        wrapper.style.alignItems = 'center';
        wrapper.appendChild(checkbox);
        firstCell.prepend(wrapper);

        const variableName = firstCell.textContent.trim();

        // Restore state
        chrome.storage.sync.get(variableName, data => {
          checkbox.checked = !!data[variableName];
        });

        // Sync with GTM row and store
        checkbox.addEventListener('change', async () => {
          chrome.storage.sync.set({ [variableName]: checkbox.checked });

          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) return;

          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (name, checked) => {
              const vars = Array.from(
                document.querySelectorAll('a.fill-cell.wd-variable-name.md-gtm-theme')
              ).filter(el =>
                el.closest('[data-table-id]')?.getAttribute('data-table-id') ===
                'variable-list-user-defined'
              );

              const el = vars.find(v => v.textContent.trim() === name);
              if (!el) return;

              const rowCheckbox = el.parentElement.parentElement.querySelector(
                'i.wd-table-row-checkbox[role="checkbox"]'
              );

              if (rowCheckbox && (rowCheckbox.getAttribute('aria-checked') === 'true') !== checked) {
                rowCheckbox.click();
              }
            },
            args: [variableName, checkbox.checked]
          });
        });
      });

      loading.style.display = 'none';
    } catch (err) {
      loading.style.display = 'none';
      errorDiv.textContent = err.message;
      console.error(err);
    }
  }

  fetchGTMData();
});
