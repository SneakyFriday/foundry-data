import { log, debug, error, i18n } from "../../dae.js";
import { daeSystemClass } from "../dae.js";
export class DAEFieldBrowser {
    static knownFieldData = {};
    static fieldDataInitialized = false;
    static isFullBrowser = false;
    static showDescriptions = true;
    enrichedFields = [];
    filteredFields = [];
    selectedIndex = 0;
    currentTab = 'All';
    tabs = [];
    browserElement = null;
    validFields;
    currentInput;
    contentElement = null;
    effectConfig;
    debouncedUpdateBrowser;
    memoizedFilterFields;
    /**
     * Creates an instance of DAEFieldBrowser.
     * @param {Record<string, {name: string, description?: string}>} validFields - The valid fields for the browser.
     * @param {DAEActiveEffectConfig} effectConfig - The effect configuration class.
     */
    constructor(validFields, effectConfig) {
        this.validFields = validFields;
        this.effectConfig = effectConfig;
        log("DaeFieldBrowser | Initializing");
        this.debouncedUpdateBrowser = foundry.utils.debounce(() => {
            this.updateBrowser();
        }, 50);
        this.memoizedFilterFields = this.memoize(this.filterFields.bind(this));
    }
    async init() {
        log("DAEFieldBrowser | Fetching field data");
        try {
            if (!DAEFieldBrowser.fieldDataInitialized) {
                // fetch data to save known category-field pairings.
                const fieldData = await foundry.utils.fetchJsonWithTimeout('modules/dae/data/field-data.json');
                Hooks.callAll("dae.setFieldData", fieldData);
                for (const [category, keys] of Object.entries(fieldData)) {
                    for (const key of keys) {
                        DAEFieldBrowser.knownFieldData[key] = { category };
                    }
                }
                DAEFieldBrowser.fieldDataInitialized = true;
            }
            //TODO cache this to avoid rebuilding if a new browser is opened with the same validFields
            this.enrichedFields = this.enrichValidFields();
            this.filteredFields = this.enrichedFields;
            this.tabs = ['All', ...new Set(this.enrichedFields.map(field => field.category))];
            this.effectConfig.updateFieldInfo();
        }
        catch (err) {
            error("DAEFieldBrowser | Failed to initialize:", err);
        }
    }
    /**
   * Enriches the valid fields with name and description if present.
   * @returns {FieldData[]} The enriched fields.
   */
    enrichValidFields() {
        return Object.entries(this.validFields)
            .map(([key, { name, description }]) => {
            const category = DAEFieldBrowser.knownFieldData[key]?.category;
            let localisationPrefix = `dae.${category ?? "Unknown"}.fieldData`;
            const nameLocalizationPath = `${localisationPrefix}.${key}.name`;
            const descriptionLocalizationPath = `${localisationPrefix}.${key}.description`;
            const localizedName = i18n(nameLocalizationPath);
            const localizedDescription = i18n(descriptionLocalizationPath);
            // If we have a localization, use it, otherwise use the default field's name, or finally the key itself
            // Logic looks a bit weird because DAE already sets the value of the validFields kvp to its key if missing.
            const finalName = (localizedName !== "") && (localizedName !== nameLocalizationPath)
                ? localizedName
                : (typeof name === "string" && name !== "" && name !== key && !name.startsWith("dae.genericSuffixes"))
                    ? name
                    : key;
            // Same logic for descriptions
            let finalDescription = (localizedDescription !== "") && (localizedDescription !== descriptionLocalizationPath)
                ? localizedDescription
                : (typeof description === "string" && description !== "" && !description.startsWith("dae.genericSuffixes"))
                    ? description
                    : '';
            if (daeSystemClass.fieldMappings[key])
                finalDescription += ` deprecated: use ${daeSystemClass.fieldMappings[key]} instead`;
            return {
                key,
                name: finalName,
                description: finalDescription,
                category: DAEFieldBrowser.knownFieldData[key]?.category || 'Other'
            };
        }).filter(field => field.category !== 'Hidden');
    }
    updateBrowser() {
        if (!this.browserElement) {
            this.createBrowser();
        }
        if (this.browserElement.style.display === 'none') {
            this.browserElement.style.display = 'block';
        }
        this.browserElement.classList.toggle('dae-fb-full-browser', DAEFieldBrowser.isFullBrowser);
        debug(`DaeFieldBrowser | Updating browser with query: ${this.currentInput?.value}`);
        this.filteredFields = this.memoizedFilterFields(this.currentInput?.value ?? "", this.currentTab);
        this.renderFields();
        this.selectField(0);
        this.positionBrowser();
        this.currentInput?.focus();
    }
    createBrowser() {
        if (this.browserElement)
            return;
        debug("DaeFieldBrowser | Creating browser element");
        const fullBrowserClass = DAEFieldBrowser.isFullBrowser ? 'active' : '';
        const descriptionsClass = DAEFieldBrowser.showDescriptions ? 'active' : '';
        const browserClasses = DAEFieldBrowser.isFullBrowser ? ['dae-fb-browser', 'dae-fb-full-browser'] : ['dae-fb-browser'];
        if ((game.release?.generation ?? 12) < 13)
            browserClasses.push('dae-v12');
        else
            browserClasses.push('application');
        this.browserElement = document.createElement('div');
        this.browserElement.id = 'dae-fb-browser';
        this.browserElement.classList.add(...browserClasses);
        this.browserElement.innerHTML = `
      <div class="dae-fb-tabs"></div>
      <div class="dae-fb-content"></div>
      <div class="dae-fb-toggle-container">
        <button class="dae-fb-toggle-button ${fullBrowserClass}" data-action="toggle-full" title="Switch between compact and full browser views">
          <i class="fas fa-expand-arrows-alt"></i> Toggle Full Browser
        </button>
        <button class="dae-fb-toggle-button ${descriptionsClass}" data-action="toggle-descriptions" title="Toggle field descriptions">
          <i class="fas fa-align-left"></i> Toggle Descriptions
        </button>
      </div>
    `;
        this.contentElement = this.browserElement.querySelector('.dae-fb-content');
        this.createTabButtons();
        this.setupEventListeners();
        document.body.appendChild(this.browserElement);
    }
    createTabButtons() {
        const tabsContainer = this.browserElement.querySelector('.dae-fb-tabs');
        if (tabsContainer) {
            const fragment = document.createDocumentFragment();
            this.tabs.forEach(tab => {
                const button = document.createElement('button');
                button.className = 'dae-fb-tab-button';
                button.dataset.action = 'switch-tab';
                button.dataset.tab = tab;
                button.textContent = i18n(`dae.fieldData.fieldCategories.${tab}`);
                fragment.appendChild(button);
            });
            tabsContainer.appendChild(fragment);
        }
    }
    /**
     * Renders filtered field elements.
     */
    renderFields() {
        if (!this.contentElement)
            return;
        debug("DaeFieldBrowser | Rendering fields");
        const fragment = document.createDocumentFragment();
        this.filteredFields.forEach((field, index) => {
            const fieldElement = this.createFieldElement(field, index);
            fragment.appendChild(fieldElement);
        });
        this.contentElement.innerHTML = '';
        this.contentElement.appendChild(fragment);
    }
    /**
     * Creates a field element.
     * @param {FieldData} field - The field data.
     * @param {number} index - The index of the field.
     * @returns {HTMLElement} The created field element.
     */
    createFieldElement(field, index) {
        const fieldElement = document.createElement('div');
        fieldElement.className = `dae-fb-field-option${index === this.selectedIndex ? ' selected' : ''}`;
        fieldElement.dataset.action = 'select-field';
        fieldElement.dataset.key = field.key;
        if (DAEFieldBrowser.isFullBrowser) {
            fieldElement.innerHTML = `<strong>${field.name}</strong> - ${field.key}${DAEFieldBrowser.showDescriptions && field.description
                ? `<br><small>${field.description}</small>`
                : ''}`;
        }
        else {
            fieldElement.textContent = field.key;
            if (DAEFieldBrowser.showDescriptions && field.description) {
                fieldElement.insertAdjacentHTML('beforeend', `<br><small>${field.description}</small>`);
            }
        }
        return fieldElement;
    }
    /**
   * Positions the browser element based on selected input field and browser settings.
   */
    positionBrowser() {
        const rect = this.currentInput?.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        let maxBrowserWidth = DAEFieldBrowser.isFullBrowser ? 880 : 400;
        let maxContentHeight = DAEFieldBrowser.isFullBrowser ? 700 : 400;
        // if (!DAEFieldBrowser.isFullBrowser && DAEFieldBrowser.showDescriptions) {
        //   maxBrowserWidth += 200;
        //   maxContentHeight += 200;
        // }
        const browserWidth = Math.min(maxBrowserWidth, viewportWidth - (rect?.left ?? 0) - 10);
        const contentHeight = Math.min(maxContentHeight, viewportHeight - (rect?.bottom ?? 0) - 100);
        const contentElement = this.browserElement.querySelector('.dae-fb-content');
        if (contentElement) {
            contentElement.style.maxHeight = `${contentHeight}px`;
        }
        this.browserElement.style.width = `${browserWidth}px`;
        this.browserElement.style.left = `${rect?.left ?? 0}px`;
        this.browserElement.style.top = `${(rect?.bottom ?? 0) + window.scrollY}px`;
    }
    setupEventListeners() {
        debug("DaeFieldBrowser | Setting up event listeners");
        document.addEventListener('click', this.handleDocumentClick.bind(this));
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        this.browserElement.addEventListener('click', this.handleBrowserClick.bind(this));
    }
    /**
     * Handles mouse click events for buttons, tab switching and field selection.
     * @param {MouseEvent} event - The mouse event.
     */
    handleBrowserClick(event) {
        debug("DaeFieldBrowser | Browser clicked");
        const target = event.target;
        const actionElement = target.closest('[data-action]');
        const action = actionElement?.dataset.action;
        switch (action) {
            case 'toggle-full':
                DAEFieldBrowser.isFullBrowser = !DAEFieldBrowser.isFullBrowser;
                this.browserElement.classList.toggle('dae-fb-full-browser', DAEFieldBrowser.isFullBrowser);
                actionElement?.classList.toggle('active', DAEFieldBrowser.isFullBrowser);
                this.switchTab('All');
                this.positionBrowser();
                break;
            case 'toggle-descriptions':
                DAEFieldBrowser.showDescriptions = !DAEFieldBrowser.showDescriptions;
                actionElement?.classList.toggle('active', DAEFieldBrowser.showDescriptions);
                this.updateBrowser();
                break;
            case 'select-field':
                const fieldOption = target.closest('.dae-fb-field-option');
                if (fieldOption) {
                    const index = Array.from(this.contentElement.children).indexOf(fieldOption);
                    this.selectField(index);
                    this.applySelectedField();
                }
                break;
            case 'switch-tab':
                const tab = actionElement?.dataset.tab;
                if (tab) {
                    this.switchTab(tab);
                }
                break;
            default:
                // Do nothing for unhandled actions
                break;
        }
        this.currentInput?.focus();
    }
    /**
     * Handles document click events to close the browser if clicking outside.
     * @param {MouseEvent} event - The mouse event.
     */
    handleDocumentClick(event) {
        if (this.browserElement &&
            !this.browserElement.contains(event.target) &&
            event.target !== this.currentInput &&
            !(this.currentInput?.classList.contains('key-input') && event.target === this.currentInput)) {
            this.hideBrowser();
        }
    }
    /**
     * Handles keydown events for navigation.
     * @param {KeyboardEvent} event - The keyboard event.
     */
    handleKeyDown(event) {
        if (!this.browserElement || this.browserElement.style.display === 'none')
            return;
        switch (event.key) {
            case 'ArrowUp':
                event.preventDefault();
                this.navigateFields(-1);
                break;
            case 'ArrowDown':
                event.preventDefault();
                this.navigateFields(1);
                break;
            case 'Enter':
                event.preventDefault();
                this.applySelectedField();
                break;
            case 'Escape':
                event.preventDefault();
                this.hideBrowser();
                break;
            case 'ArrowLeft':
            case 'ArrowRight':
                if (DAEFieldBrowser.isFullBrowser) {
                    event.preventDefault();
                    this.navigateTabs(event.key === 'ArrowLeft' ? -1 : 1);
                }
                break;
            case 'Tab':
                this.hideBrowser();
                break;
        }
    }
    hideBrowser() {
        debug("DaeFieldBrowser | Hiding browser");
        if (this.browserElement) {
            this.browserElement.style.display = 'none';
        }
    }
    /**
     * Switches to the specified tab.
     * @param {string} tab - The tab to switch to.
     */
    switchTab(tab) {
        debug(`DaeFieldBrowser | Switching to tab: ${tab}`);
        this.currentTab = tab;
        const tabButtons = this.browserElement.querySelectorAll('.dae-fb-tab-button');
        tabButtons.forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
        this.updateBrowser();
    }
    /**
     * Navigates through fields.
     * @param {number} direction - The direction to navigate (-1 for up, 1 for down).
     */
    navigateFields(direction) {
        const newIndex = (this.selectedIndex + direction + this.filteredFields.length) % this.filteredFields.length;
        this.selectField(newIndex);
    }
    /**
     * Navigates through tabs.
     * @param {number} direction - The direction to navigate (-1 for left, 1 for right).
     */
    navigateTabs(direction) {
        const currentTabIndex = this.tabs.indexOf(this.currentTab);
        const newTabIndex = (currentTabIndex + direction + this.tabs.length) % this.tabs.length;
        this.switchTab(this.tabs[newTabIndex]);
    }
    memoize(fn, maxSize = 100) {
        const cache = new Map();
        return ((...args) => {
            const key = `${args.join('|')}|${DAEFieldBrowser.isFullBrowser}|${DAEFieldBrowser.showDescriptions}`;
            if (cache.has(key))
                return cache.get(key);
            const result = fn(...args);
            if (cache.size >= maxSize)
                cache.delete(cache.keys().next().value ?? "");
            return cache.set(key, result).get(key);
        });
    }
    /**
   * Filters the fields based on query and tab.
   * @param {string} query - The search query.
   * @param {string} tab - The current tab.
   * @returns {FieldData[]} The filtered fields.
   */
    filterFields(query, tab) {
        const lowercaseQuery = query.toLowerCase();
        const isAllTab = tab === 'All';
        return this.enrichedFields.filter(field => {
            if (DAEFieldBrowser.isFullBrowser && !isAllTab && field.category !== tab) {
                return false;
            }
            return field.key.toLowerCase().includes(lowercaseQuery) ||
                field.name.toLowerCase().includes(lowercaseQuery) ||
                (DAEFieldBrowser.showDescriptions &&
                    field.description &&
                    field.description.toLowerCase().includes(lowercaseQuery));
        });
    }
    /**
     * Selects a field at the specified index.
     * @param {number} index - The index of the field to select.
     */
    selectField(index) {
        debug(`DaeFieldBrowser | Selecting field at index: ${index}`);
        const previousSelected = this.contentElement.querySelector('.dae-fb-field-option.selected');
        if (previousSelected) {
            previousSelected.classList.remove('selected');
        }
        this.selectedIndex = index;
        const newSelected = this.contentElement.children[index];
        if (newSelected) {
            newSelected.classList.add('selected');
            newSelected.scrollIntoView({ block: 'nearest' });
        }
    }
    /**
   * Applies the selected field to the DAEActiveEffectConfig input.
   */
    applySelectedField() {
        debug("DaeFieldBrowser | Applying selected field");
        const selectedField = this.filteredFields[this.selectedIndex];
        console.log(selectedField, this.currentInput);
        if (selectedField && this.currentInput) {
            this.currentInput.value = selectedField.key;
            this.currentInput.blur();
            this.hideBrowser();
            this.effectConfig.onFieldSelected();
        }
    }
    /**
   * Sets the current input element to the selected one. Called by event listeners in DAEActiveEffectConfig.
   * @param {HTMLInputElement} input - The input element to set.
   */
    setInput(input) {
        debug("DAEFieldBrowser | Setting input");
        this.currentInput = input;
    }
    /**
     * Gets the field information for a given key.
     * Used by DAEActiveEffectConfig to populate names and descriptions below the input field.
     * @param {string} key - The key to get field information for.
     * @returns {FieldData} The field information.
     */
    getFieldInfo(key) {
        return this.enrichedFields?.find(f => f.key === key) || {
            key: key,
            name: key,
            description: "",
            category: ""
        };
    }
}
