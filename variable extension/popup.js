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
          const vars = Array.from(
            document.querySelectorAll('a.fill-cell.wd-variable-name.md-gtm-theme')
          ).filter(el =>
            el.closest('[data-table-id]')?.getAttribute('data-table-id') === 'variable-list-user-defined'
          );

          if (!vars.length) {
            return { error: 'No User-Defined Variables found. Open GTM Variables page.' };
          }

          return {
            variables: vars.map(el => ({
              name: el.textContent.trim(),
              url: 'https://tagmanager.google.com/api/accounts' +
                   el.href.split('accounts')[1] + '/references'
            }))
          };
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

      ['Variable Name', 'Tags', 'Triggers', 'Variables'].forEach(text => {
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
          .map(e => e.name || e.publicId);

        const triggers = v.entities
          .filter(e => 'triggerKey' in e)
          .map(e => e.name || e.publicId);

        const linkedVariables = v.entities
          .filter(e => 'variableKey' in e)
          .map(e => e.name || e.publicId);

        const tr = document.createElement('tr');

        [
          v.variableName,
          tags.join(', ') || ' ',
          triggers.join(', ') || ' ',
          linkedVariables.join(', ') || ' '
        ].forEach(text => {
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

      // Add custom checkboxes + storage sync
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

        // Restore saved state
        chrome.storage.sync.get(variableName, data => {
          if (data[variableName] !== undefined) {
            checkbox.checked = data[variableName];
          }
        });

        // Sync GTM checkbox + save state
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
                el.closest('[data-table-id]')?.getAttribute('data-table-id') === 'variable-list-user-defined'
              );

              const el = vars.find(v => v.textContent.trim() === name);
              if (!el) return;

              const rowCheckbox =
                el.parentElement.parentElement.querySelector(
                  'i.wd-table-row-checkbox[role="checkbox"]'
                );

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

      loading.style.display = 'none';

    } catch (err) {
      loading.style.display = 'none';
      errorDiv.textContent = err.message;
      console.error(err);
    }
  }

  fetchGTMData();
});
