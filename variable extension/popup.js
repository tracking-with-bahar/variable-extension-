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

      // ================= GET VARIABLES =================
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          variables: Array.from(
            document.querySelectorAll('[data-table-id="variable-list-user-defined"] tr')
          )
            .map(row => {
              const nameEl = row.querySelector(
                'a.fill-cell.wd-variable-name.md-gtm-theme'
              );
              if (!nameEl) return null;

              return {
                name: nameEl.innerText.trim(),
                type: row.children[2]?.innerText.trim() || '',
                url:
                  'https://tagmanager.google.com/api/accounts' +
                  nameEl.href.split('accounts')[1] +
                  '/references'
              };
            })
            .filter(Boolean)
        })
      });

      // ================= FETCH REFERENCES =================
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
            return { variableName: v.name, variableType: v.type, entities: [] };
          }
        })
      );

      // ================= TOOLBAR =================
      const toolbar = document.createElement('div');
      toolbar.style.display = 'flex';
      toolbar.style.alignItems = 'center';
      toolbar.style.margin = '10px 0';

      const exportBtn = document.createElement('button');
      exportBtn.textContent = 'Export CSV';

      const searchInput = document.createElement('input');
      searchInput.placeholder = 'Search variable';
      searchInput.style.margin = '0 10px';
      searchInput.style.width = '220px';

      const selectedCounter = document.createElement('span');
      selectedCounter.style.marginLeft = 'auto';
      selectedCounter.style.display = 'none';

      toolbar.append(exportBtn, searchInput, selectedCounter);
      container.appendChild(toolbar);

      // ================= TABLE =================
      const table = document.createElement('table');
      table.style.width = '100%';

      table.innerHTML = `
        <thead>
          <tr>
            <th>Variable Name</th>
            <th>Type</th>
            <th>Tags</th>
            <th>Triggers</th>
            <th>Variables</th>
            <th>Delete</th>
          </tr>
        </thead>
      `;

      const tbody = document.createElement('tbody');

      variablesData.forEach(v => {
        const tr = document.createElement('tr');

        const tags = v.entities.filter(e => e.tagKey).map(e => e.name).join(', ');
        const triggers = v.entities.filter(e => e.triggerKey).map(e => e.name).join(', ');
        const linkedVars = v.entities.filter(e => e.variableKey).map(e => e.name).join(', ');
        const hasReferences = !!(tags || triggers || linkedVars);

        // NAME + CHECKBOX
        const nameTd = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'custom-variable-checkbox';
        checkbox.style.marginRight = '6px';
        nameTd.append(checkbox, v.variableName);
        tr.appendChild(nameTd);

        [v.variableType, tags, triggers, linkedVars].forEach(text => {
          const td = document.createElement('td');
          td.textContent = text || '';
          tr.appendChild(td);
        });

        // DELETE ICON
        const deleteTd = document.createElement('td');
        const deleteImg = document.createElement('img');
        deleteImg.src = 'icons/removeicon.png';
        deleteImg.style.cursor = 'pointer';
        deleteImg.style.display = 'none';
        deleteTd.appendChild(deleteImg);
        tr.appendChild(deleteTd);

        // ===== CHECKBOX LOGIC =====
        checkbox.addEventListener('change', async () => {
          deleteImg.style.display =
            checkbox.checked && !hasReferences ? 'inline-block' : 'none';

          updateCounter();

          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (name, checked) => {
              const el = [...document.querySelectorAll(
                'a.fill-cell.wd-variable-name.md-gtm-theme'
              )].find(e => e.textContent.trim() === name);

              const rowCheckbox = el?.closest('tr')
                ?.querySelector('i.wd-table-row-checkbox');

              if (
                rowCheckbox &&
                (rowCheckbox.getAttribute('aria-checked') === 'true') !== checked
              ) {
                rowCheckbox.click();
              }
            },
            args: [v.variableName, checkbox.checked]
          });
        });

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      container.appendChild(table);

      // ================= BULK DELETE =================
      container.addEventListener('click', async e => {
        if (e.target.tagName !== 'IMG') return;
        if (e.target.style.display !== 'inline-block') return;

        const rowsToDelete = [...tbody.querySelectorAll('tr')].filter(row => {
          const cb = row.querySelector('.custom-variable-checkbox');
          const img = row.querySelector('img');
          return cb?.checked && img?.style.display === 'inline-block';
        });

        if (!rowsToDelete.length) return;

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            document.querySelector('button.icon.icon-delete.icon--button')?.click();
            setTimeout(() => {
              document
                .querySelector('button.btn.btn-action.wd-action-dialog-confirm')
                ?.click();
            }, 300);
          }
        });

        rowsToDelete.forEach(r => r.remove());
        updateCounter();
      });

      // ================= COUNTER =================
      function updateCounter() {
        const count = container.querySelectorAll('.custom-variable-checkbox:checked').length;
        selectedCounter.style.display = count ? 'inline-block' : 'none';
        selectedCounter.textContent = count ? `${count} selected` : '';
      }

      // ================= SEARCH =================
      searchInput.addEventListener('input', () => {
        const value = searchInput.value.toLowerCase();
        tbody.querySelectorAll('tr').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(value)
            ? ''
            : 'none';
        });
      });

      // ================= CSV =================
      exportBtn.addEventListener('click', () => {
        const rows = [...tbody.querySelectorAll('tr')].filter(
          r => r.style.display !== 'none'
        );

        const csv = [
          [...table.querySelectorAll('th')].map(th => `"${th.textContent}"`).join(',')
        ];

        rows.forEach(r => {
          csv.push(
            [...r.querySelectorAll('td')]
              .map(td => `"${td.textContent.replace(/"/g, '""')}"`)
              .join(',')
          );
        });

        const blob = new Blob(['\uFEFF' + csv.join('\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'gtm-variables.csv';
        a.click();
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
