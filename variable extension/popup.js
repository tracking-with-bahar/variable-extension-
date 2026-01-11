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

      // Extract variables from GTM UI
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

            variables.push({
              name: nameEl.innerText.trim(),
              type: row.children[2]?.innerText.trim() || '',
              url:
                'https://tagmanager.google.com/api/accounts' +
                nameEl.href.split('accounts')[1] +
                '/references'
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
              variableType: v.type,
              entities: parsed?.default?.entity || []
            };
          } catch {
            return {
              variableName: v.name,
              variableType: v.type,
              entities: []
            };
          }
        })
      );

      // ===== BUILD TABLE =====
      const table = document.createElement('table');
      table.style.width = '100%';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');

      ['Variable Name', 'Variable Type', 'Tags', 'Triggers', 'Variables'].forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        th.style.border = '1px solid #ccc';
        th.style.padding = '6px';
        th.style.textAlign = 'center';
        headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');

      variablesData.forEach(v => {
        const tags = v.entities
          .filter(e => 'tagKey' in e)
          .map(e => e.name || e.publicId)
          .join(', ') || '';

        const triggers = v.entities
          .filter(e => 'triggerKey' in e)
          .map(e => e.name || e.publicId)
          .join(', ') || '';

        const linkedVariables = v.entities
          .filter(e => 'variableKey' in e)
          .map(e => e.name || e.publicId)
          .join(', ') || '';

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

      // =====  CREATE TOOLBAR WITH SEARCH =====
      const controls = document.createElement('div');
      controls.style.display = 'flex';
      controls.style.alignItems = 'center';
      controls.style.margin = '10px 0';

      // Left: Export CSV
      const left = document.createElement('div');
      left.style.flex = '1';

      const exportBtn = document.createElement('button');
      exportBtn.textContent = 'Export CSV';
      exportBtn.style.padding = '6px 12px';
      exportBtn.style.cursor = 'pointer';
      left.appendChild(exportBtn);

      // Center: Search Input
      const center = document.createElement('div');
      center.style.flex = '1';
      center.style.textAlign = 'center';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Search variable...';
      searchInput.style.padding = '6px 10px';
      searchInput.style.width = '220px';
      searchInput.style.border = '1px solid #ccc';
      searchInput.style.borderRadius = '4px';
      center.appendChild(searchInput);

      // Selected counter
      const right = document.createElement('div');
      right.style.flex = '1';
      right.style.textAlign = 'right';

      const selectedCounter = document.createElement('span');
      selectedCounter.style.display = 'none';
      selectedCounter.style.fontSize = '14px';
      selectedCounter.style.padding = '4px 8px';
      selectedCounter.style.border = '1px solid #1a73e8';
      selectedCounter.style.background = '#1a73e8';
      selectedCounter.style.color = '#fff';
      selectedCounter.style.borderRadius = '4px';
      right.appendChild(selectedCounter);

      controls.appendChild(left);
      controls.appendChild(center);
      controls.appendChild(right);

      container.appendChild(controls);
      container.appendChild(table);

      // ===== UPDATE SELECTED COUNT =====
      function updateSelectedCount() {
        const checkboxCount = container.querySelectorAll(
          '.custom-variable-checkbox:checked'
        ).length;

        if (checkboxCount > 0) {
          selectedCounter.style.display = 'inline-block';
          selectedCounter.textContent = checkboxCount + ' selected';
        } else {
          selectedCounter.style.display = 'none';
          selectedCounter.textContent = '';
        }
      }

      // ===== CSV EXPORT =====
      exportBtn.addEventListener('click', () => {
        const selectedRows = Array.from(tbody.querySelectorAll('tr')).filter(
          row => row.querySelector('.custom-variable-checkbox')?.checked
        );

        const rowsToExport =
          selectedRows.length > 0 ? selectedRows : Array.from(tbody.querySelectorAll('tr'));

        const headers = Array.from(thead.querySelectorAll('th')).map(th =>
          th.textContent.trim()
        );

        const csvRows = [];
        csvRows.push(headers.map(h => `"${h}"`).join(','));

        rowsToExport.forEach(row => {
          const cells = Array.from(row.querySelectorAll('td')).map(td =>
            `"${td.textContent.replace(/"/g, '""')}"`
          );
          csvRows.push(cells.join(','));
        });

        const csvContent = '\uFEFF' + csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `gtm-variables-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });

      // ====== ADD CHECKBOXES =====
      tbody.querySelectorAll('tr').forEach(row => {
        const firstCell = row.querySelector('td');
        if (!firstCell) return;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'custom-variable-checkbox';
        checkbox.style.marginRight = '6px';
        firstCell.prepend(checkbox);

        const variableName = firstCell.textContent.trim();

        chrome.storage.sync.get(variableName, data => {
          checkbox.checked = !!data[variableName];
          updateSelectedCount();
        });

        checkbox.addEventListener('change', async () => {
          chrome.storage.sync.set({ [variableName]: checkbox.checked });
          updateSelectedCount();

          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) return;

          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (name, checked) => {
              const el = Array.from(
                document.querySelectorAll('a.fill-cell.wd-variable-name.md-gtm-theme')
              ).find(v => v.textContent.trim() === name);

              if (!el) return;

              const rowCheckbox = el
                .closest('tr')
                ?.querySelector('i.wd-table-row-checkbox[role="checkbox"]');

              if (
                rowCheckbox &&
                (rowCheckbox.getAttribute('aria-checked') === 'true') !== checked
              ) {
                rowCheckbox.click();
              }
            },
            args: [variableName, checkbox.checked]
          });
        });
      });

      updateSelectedCount();

      // ===== SEARCH FEATURE =====
      searchInput.addEventListener('input', function () {
        const value = this.value.toLowerCase();

        tbody.querySelectorAll('tr').forEach(row => {
          const variableName = row.children[0]?.textContent.toLowerCase() || '';
          row.style.display = variableName.includes(value) ? '' : 'none';
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
