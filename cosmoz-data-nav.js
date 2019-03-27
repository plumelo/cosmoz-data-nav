// @license Copyright (C) 2015 Neovici AB - Apache 2 License
/*global Cosmoz, Polymer */

(function () {
	'use strict';
	const _async = window.requestIdleCallback || window.requestAnimationFrame || Polymer.Base.async,
		_hasDeadline = 'IdleDeadline' in window,
		_asyncPeriod = (cb, timeout = 1500) => {
			_async(() => cb(), _hasDeadline && { timeout });
		},
		_doAsyncSteps = (steps, timeout) => {
			const callStep = () => {
				if (!Array.isArray(steps) || steps.length < 1) {
					return;
				}
				const step = steps.shift();
				step();
				_asyncPeriod(callStep, timeout);
			};
			_asyncPeriod(callStep, timeout);
			return () => steps.forEach(step => step());
		},
		{
			Async,
			Debouncer,
			FlattenedNodesObserver,
			IronResizableBehavior,
			Templatize,
			mixinBehaviors
		} = Polymer;


	class CosmozDataNav extends mixinBehaviors([
		IronResizableBehavior,
		Cosmoz.TranslatableBehavior
	], Polymer.Element) {

		static get is() {
			return 'cosmoz-data-nav';
		}

		static get properties() {
			return {
				/**
				 * The array of buffer elements.
				 */
				_elements: {
					type: Array,
					value() {
						return [this._createElement()];
					}
				},

				/**
				 * The name of the variable to add to the binding scope for the array
				 * element associated with a template instance.
				 */
				as: {
					type: String,
					value: 'item'
				},

				/**
				 * The name of the variable to add to the binding scope with the index
				 * for the item.
				 */
				indexAs: {
					type: String,
					value: 'index'
				},

				/**
				 * An array containing items from which a selection can be made.
				 */
				items: {
					type: Array,
					value() {
						return [];
					},
					notify: true,
					observer: '_itemsChanged'
				},

				/**
				 * The length of items array.
				 */
				queueLength: {
					type: Number,
					notify: true,
					readOnly: true
				},

				hasItems: {
					type: Boolean,
					readOnly: true,
					reflectToAttribute: true
				},

				elementsBuffer: {
					type: Number,
					value: 3
				},

				/**
				 * Number of items after the currently selected one to preload.
				 */
				preload: {
					type: Number,
					value: 1
				},

				/**
				 * The currently selected index.
				 */
				selected: {
					type: Number,
					value: 0,
					notify: true,
					observer: '_updateSelected'
				},

				/**
				 * The index of the next element.
				 */
				selectedNext: {
					type: Number,
					notify: true,
					value: 1,
					readOnly: true
				},

				/**
				 * The currently selected element (holder)
				 */
				selectedElement: {
					type: Object,
					notify: true,
					readOnly: true,
					computed: '_getElement(selected, _elements.*)'
				},

				/**
				 * The currently selected element (instance)
				 */
				selectedInstance: {
					type: Object,
					notify: true,
					readOnly: true,
					computed: '_getInstance(selectedElement)'
				},

				/**
				 * The currently selected item, or `null` if no item is selected.
				 */
				selectedItem: {
					type: Object,
					notify: true,
					readOnly: true,
					computed: '_getItem(selected, items.*)'
				},

				/**
				 * True if cosmoz-data-nav should try to maintain selection when
				 * `items` change.
				 */
				maintainSelection: {
					type: Boolean,
					value: false
				},

				/**
				 * The attribute that elements which control the `selected` of this element
				 * should have. The value of the attribute can be `-1` or `+1`.
				 */
				selectAttribute: {
					type: String,
					value: 'cosmoz-data-nav-select'
				},

				/**
				 *  True if the element is currently animating.
				 */
				animating: {
					type: Boolean,
					value: false,
					reflectToAttribute: true,
				},

				/**
				 * True if selecting a element with a index smaller than the current one.
				 */
				reverse: {
					type: Boolean,
					value: false,
					reflectToAttribute: true,
				},

				/**
				 * Function used to determine if a item is incomplete and needs to be preloaded.
				 * The default values is a function that requires item to be a `Object`.
				 */
				isIncompleteFn: {
					type: Function,
					value() {
						return item => item == null || typeof item !== 'object';
					}
				},

				/**
				 * The hash parameter to use for selecting an item.
				 */
				hashParam: {
					type: String
				},

				/**
				 * The route hash parameters extracted by the `cosmoz-page-location`
				 * element.
				 */
				_routeHashParams: {
					type: Object
				},

				/**
				 *
				 */
				idPath: {
					type: String,
					value: 'id'
				},

				/**
				 * True if element should render items even if it is not visible.
				 */
				hiddenRendering: {
					type: Boolean,
					value: false
				}
			};
		}

		constructor() {
			super();
			this._previouslySelectedItem = null;
			this._cache = {};
			this._preloadIdx = 0;
			this._boundOnTemplatesChange = this._onTemplatesChange.bind(this);
			this._onCachePurgeHandler = this._onCachePurge.bind(this);
		}

		connectedCallback() {
			super.connectedCallback();
			this._templatesObserver = new FlattenedNodesObserver(
				this.$.templatesSlot,
				this._boundOnTemplatesChange
			);
			window.addEventListener('cosmoz-cache-purge', this._onCachePurgeHandler);
			this.addEventListener('tap', this._onTap);
			this.addEventListener('transitionend', this._onTransitionEnd);
		}

		disconnectedCallback() {
			super.disconnectedCallback();
			if (this._templatesObserver) {
				this._templatesObserver.disconnect();
				this._templatesObserver = null;
			}

			if (this._selectDebouncer != null) {
				this._selectDebouncer.cancel();
			}

			this._previouslySelectedItem = null;
			this._cache = {};
			this._indexRenderQueue = [];
			window.removeEventListener('cosmoz-cache-purge', this._onCachePurgeHandler);
			this.removeEventListener('tap', this._onTap);
			this.removeEventListener('transitionend', this._onTransitionEnd);

			this.splice('_elements', 0, this._elements.length, this._createElement())
				.forEach(element => {
					this._removeInstance(element.__instance);
					this._removeInstance(element.__incomplete);
					element.__instance = element.__incomplete = null;
				});
		}

		_onTemplatesChange(change) {
			if (!this._elementTemplate) {
				const templates = change.addedNodes.filter(n => n.nodeType === Node.ELEMENT_NODE && n.tagName === 'TEMPLATE'),
					elementTemplate = templates.find(n => n.matches(':not([incomplete])')),
					incompleteTemplate = templates.find(n => n.matches('[incomplete]')) || this.$.incompleteTemplate;

				if (!elementTemplate) {
					console.warn('cosmoz-data-nav requires a template');
					return;
				}
				this._templatize(elementTemplate, incompleteTemplate);
			}

			const elements = this._elements,
				length = elements.length;

			this.splice('_elements', -1, 0, ...Array(this.elementsBuffer - length)
				.fill().map(this._createElement, this));

			this.flushTemplatesInit = _doAsyncSteps(elements.map(el => {
				this.appendChild(el);
				return this._createIncomplete.bind(this, el);
			}));
		}

		_templatize(elementTemplate, incompleteTemplate) {
			this._elementTemplate = elementTemplate;
			this._incompleteTemplate = incompleteTemplate;

			const baseProps = {
				prevDisabled: true,
				nextDisabled: true,
				[this.indexAs]: true
			};
			this._elementCtor = Templatize.templatize(this._elementTemplate, this, {
				instanceProps: Object.assign({ [this.as]: true }, baseProps),
				parentModel: true,
				forwardHostProp: this._forwardHostProp,
				notifyInstanceProp: this._notifyInstanceProp
			});
			this._incompleteCtor = Templatize.templatize(this._incompleteTemplate, this, {
				instanceProps: baseProps,
				parentModel: true,
				forwardHostProp: this._forwardHostProp,
			});
		}

		get _allInstances() {
			return this._elements
				.reduce((p, n) => p.concat([n.__instance, n.__incomplete]), [])
				.filter(i => i != null);
		}

		get _allElementInstances() {
			return this._elements
				.map(e => e.__instance)
				.filter(i => i != null);
		}

		_forwardHostProp(prop, value) {
			const instances = this._allInstances;
			if (!instances || !instances.length) {
				return;
			}
			instances.forEach(inst => inst.forwardHostProp(prop, value));
		}

		_notifyInstanceProp(inst, prop, value) {
			const index = inst.index,
				item = this.items[index];
			if (prop !== this.as || value === item || this._allElementInstances.indexOf(inst) < 0) {
				return;
			}
			this.removeFromCache(item);
			this.set(['items', index], value);
		}

		_createElement() {
			const element = document.createElement('div');
			element.setAttribute('slot', 'items');
			element.classList.add('animatable');
			return element;
		}

		_createIncomplete(element) {
			if (element.__incomplete) {
				return;
			}
			const incomplete = new this._incompleteCtor({});
			element.__incomplete = incomplete;
			element.appendChild(incomplete.root);
		}

		/**
		 * Selects an item by index.
		 *
		 * @param  {Number} index The index
		 * @return {void}
		 */
		select(index) {
			const length = this.items && this.items.length;
			if (!length || index < 0 || index >= length) {
				return;
			}
			this.reverse = index < this.selected;
			this.selected = index;
		}

		/**
		 * Replace an id in the `items` element list with the full data of the item.
		 *
		 * @param  {type} id     The id currently stored in the `items` array
		 * @param  {Object} item The full data of object
		 * @return {void}
		 */
		setItemById(id, item) {
			const items = this.items,
				matches = items.filter(item => this._getItemId(item) === id);

			if (matches.length === 0) {
				console.warn('trying to replace an item that is not in the list', id, item);
				return;
			} else if (matches.length > 1) {
				console.warn('found multiple items with same id');
			}

			this._cache[id] = Object.assign({}, item);
			matches.forEach(match => this.set(['items', items.indexOf(match)], Object.assign({}, item)));

			this._preload();

			if (this.animating || this.selected == null) {
				return;
			}

			this._updateSelected();
		}

		clearCache() {
			this._cache = {};
		}

		removeFromCache(item) {
			if (item == null) {
				return;
			}
			const cache = this._cache,
				key = Object.keys(cache).find(k => cache[k] === item);
			if (key != null) {
				delete cache[key];
			}
		}

		/**
		 * Observes full changes to `items` properties
		 * and replaces cached items with full data if available.
		 *
		 * @param  {type} items description
		 * @return {type}       description
		 */
		_itemsChanged(items) {
			const length = items && items.length;

			// update read-only properties
			this._setQueueLength(length >> 0);
			this._setHasItems(!!length);

			// replace incomplete items with cached item data
			if (length) {
				items.forEach((item, index) => {
					if (this.isIncompleteFn(item) && this._cache[item]) {
						this.set(['items', index], this._cache[item]);
					}
				});
			}

			// synchronize `selected` with hash params
			if (this._updateSelectedFromHash()) {
				return;
			}

			// reset queue to 0 or maintain selection
			let index = 0;
			if (this.maintainSelection && this._previouslySelectedItem != null) {
				// search for previously selected item by reference
				index = items.indexOf(this._previouslySelectedItem);

				// if not found, search by id
				if (index === -1) {
					const prevId = this._getItemId(this._previouslySelectedItem);
					index = items.findIndex(item => this._getItemId(item) === prevId);
				}

				// if still not found, remain on the selected index, but force re-render
				if (index === -1) {
					return this._updateSelected();
				}
			}

			// update selected or force re-render if selected did not change
			return this.selected === index ? this._updateSelected() : this.selected = index;
		}

		/**
		 * Observes changed to `selected` property and
		 * updates related properties and the `selected` page.
		 *
		 * @param  {Number} selected The selected property
		 * @param  {Number} previous The previous value of selected property
		 * @return {void}
		 */
		_updateSelected(selected = this.selected, previous) {
			const position = selected < this.items.length ? selected : selected - 1;
			this._setSelectedNext((position || 0) + 1);
			this._preload(position);
			this._previouslySelectedItem = this.items[position];

			const element = this._getElement(position);

			if (!element) {
				return;
			}

			this._updateHashForSelected(position);

			const classes = element.classList,
				animating = this.animating && previous != null && previous !== position,
				prev = animating && this._getElement(previous);

			if (!animating) {
				this._elements.forEach(el => el.classList.remove('selected'));
			}

			classes.toggle('in', !!this.animating);
			classes.add('selected');

			if (!animating) {
				if (this.isConnected) {
					this._synchronize();
				}
				return;
			}

			requestAnimationFrame(() => {
				if (prev && element.offsetWidth) {
					prev.classList.add('out');
					prev.classList.remove('selected');
				}
				classes.remove('in');
			}, 8);
		}

		/**
		 * Handles `transitionend` event and cleans up animation classe and properties
		 *
		 * @param  {TransitionEvent} e The event
		 * @return {void}
		 */
		_onTransitionEnd(e) {
			const elements = this._elements;

			if (!this.animating || elements.indexOf(e.target) < 0) {
				return;
			}

			this.animating = false;
			elements.forEach(el => el.classList.remove('in', 'out'));
			this._synchronize();
		}

		/**
		 * Preloads items that are not loaded depending on the currently
		 * selected item and the `preload` property.
		 *
		 * @fires need-data
		 * @param  {Number} index The index to preload from
		 * @return {void}
		 */
		_preload(index = this._preloadIdx) {
			const items = this.items;

			if (!Array.isArray(items) || items.length === 0) {
				return;
			}

			const item = items[index];

			if (this.isIncompleteFn(item)) {
				this.dispatchEvent(new CustomEvent('need-data', {
					bubbles: true,
					composed: true,
					detail: {
						id: item,
						render: true
					}
				}));
				return;
			}

			if (index >= Math.min(this.selected + this.preload, items.length - 1)) {
				return;
			}

			this._preloadIdx = index + 1;
			this._preload();
		}

		_getBaseProps(index) {
			return {
				prevDisabled: index < 1,
				nextDisabled: index + 1 >= this.items.length,
				[this.indexAs]: Math.min(Math.max(index, 0), this.items.length - 1)
			};
		}

		_getElement(index, _elements = this._elements) {
			const elements = _elements && _elements.base || _elements;
			return elements[index % (this.elementsBuffer || elements.length)];
		}

		_getInstance(selectedElement) {
			if (selectedElement == null || selectedElement.children.length < 2) {
				return;
			}
			// index 0 is incomplete element
			return selectedElement.children[1];
		}

		_getItem(index, items = this.items) {
			const arr = items.base ? items.base : items;
			return arr[index];
		}

		_resetElement(index) {
			const element = this._getElement(index);
			if (!element || !element.__incomplete) {
				return;
			}

			const item = this.items[index],
				baseProps = this._getBaseProps(index),
				incomplete = element.__incomplete,
				instance = element.__instance;

			if (instance) {
				Object.assign(instance, baseProps);
			}

			if (!this.isIncompleteFn(item) && element.item === item) {
				return;
			}

			Object.assign(incomplete, baseProps);

			if (element._reset) {
				return;
			}
			element._reset = true;
			incomplete._showHideChildren(false);

			if (!instance) {
				return;
			}

			instance._showHideChildren(true);
		}

		_removeInstance(instance) {
			if (!instance) {
				return;
			}
			instance.children.forEach(child => child.parentNode.removeChild(child));
		}

		/**
		* Syncronizes the `items` data with the created template instances
		* depending on the currently selected item.
		* @return {type}  description
		*/
		_synchronize() {
			const selected = this.selected,
				buffer = this.elementsBuffer,
				offset = buffer / 2 >> 0,
				max = Math.max,
				min = Math.min,
				length = this.items.length;

			const start = min(max(selected - offset, 0), length ? length - buffer : 0),
				end = max(min(selected + offset, length ? length - 1 : 0), buffer - 1),
				indexes = Array(end + 1).fill().map((u, i) => i).slice(start >= 0 ? start : 0);

			// Reset items
			indexes.forEach(i => this._resetElement(i));
			this._indexRenderQueue = indexes;
			_asyncPeriod(this._renderQueue.bind(this));

		}

		/**
		 * Handle `tap` event and finds the closest item to the rootTarget that has a `selectAttribute` attribute.
		 * If the attribute is `next` or `previous` the `selectNext` or `selectPrevious` action is called.
		 *
		 * @param  {Event} event The tap event
		 * @return {void}
		 */
		_onTap(event) {
			if (this.animating) {
				return;
			}
			const path = event.composedPath(),
				attr = this.selectAttribute,
				selectEl = path.find(e => e && e.hasAttribute && e.hasAttribute(attr));

			if (!selectEl) {
				return;
			}
			let inBetween = path.slice(path.indexOf(selectEl)),
				ancestorNav = inBetween.find(e => e && e.constructor && e.constructor.is === this.constructor.is),
				select;

			if (ancestorNav !== this) {
				return;
			}

			select = parseInt(selectEl.getAttribute(attr), 10);

			if (isNaN(select)) {
				return;
			}
			this._selectDebouncer = Debouncer.debounce(this._selectDebouncer,
				Async.animationFrame,
				() => {
					this.animating = true;
					this.select(this.selected + select);
				}
			);
		}

		/**
		* True if the current element is visible.
		*/
		get _isVisible() {
			return Boolean(this.offsetWidth || this.offsetHeight);
		}

		_isDescendantOf(descendant, ancestor, limit = this) {
			let parent = descendant;
			while (parent && parent !== limit) {
				if (parent === ancestor) {
					return true;
				}
				const nextParent = parent.parentNode;
				if (nextParent == null && parent instanceof ShadowRoot) {
					parent = parent.host;
					continue;
				}
				parent = nextParent;

			}
			return false;
		}

		/**
		 * Check if a element is a descendant of another element
		 * @param {HTMLElement} descendant Element to test
		 * @param {HTMLElement} element Ancestor element
		 * @returns {Boolean} True if  element is a descendant
		 */
		_isDescendantOfElementInstance(descendant, element) {
			if (!element) {
				return false;
			}
			const instance = element.__instance;

			if (!instance) {
				return false;
			}

			return instance.children
				.filter(c => c.nodeType === Node.ELEMENT_NODE)
				.some(child => this._isDescendantOf(descendant, child));
		}

		/**
		 * Check if a element is a descendant of the currently selected element.
		 *
		 * @param  {HTMLElement} resizable A descendant resizable element
		 * @return {Boolean} True if the element should be notified
		 */
		resizerShouldNotify(resizable) {
			return this._isDescendantOfElementInstance(resizable, this.selectedElement);
		}

		/**
		 * Handles resize notifications from descendants.
		 *
		 * @param  {Event} event The resize event
		 * @return {void}
		 */
		_onDescendantIronResize(event) {
			if (this._notifyingDescendant || this.animating || !this._isVisible || !this.resizerShouldNotify(event.target)) {
				event.stopPropagation();
				return;
			}

			if (Polymer.Settings.useShadow && event.target.domHost === this) {
				return;
			}
			this._fireResize();
		}

		notifyResize() {
			if (!this.isConnected || this.animating || !this._isVisible) {
				return;
			}
			IronResizableBehavior.notifyResize.call(this);
		}

		/**
		 * Notifies a descendant resizable of the element.
		 *
		 * @param  {HTMLElement} element The element to search within for a resizable
		 * @return {Boolean} True if descendant has been notified.
		 */
		_notifyElementResize(element = this.selectedElement) {
			if (!this.isConnected || !element) {
				return false;
			}

			const instance = element.__instance;

			if (instance == null || instance.__resized) {
				return false;
			}

			const resizable = this._interestedResizables
				.find(resizable => this._isDescendantOfElementInstance(resizable, element));

			if (!resizable) {
				return false;
			}

			this._notifyDescendant(resizable);
			return instance.__resized = true;
		}

		/**
		 * Select item by id.
		 *
		 * @deprecated
		 * @param  {String|Number} id The item's id
		 * @return {void}
		 */
		selectById(id) {
			var index,
				item;
			for (index = 0; index < this.items.length; index++) {
				item = this.items[index];
				if (typeof item === 'object' && item.id === id || item === id) {
					this.selected = index;
					return;
				}
			}
		}

		_forwardItem(element, item, idx) {
			this._removeInstance(element.__instance);
			if (Polymer.flush) {
				Polymer.flush();
			}
			const props = Object.assign({ [this.as]: item }, this._getBaseProps(idx));
			const instance = new this._elementCtor(props);

			element.__instance = instance;
			element.item = item;
			element._reset = false;
			element.appendChild(instance.root);
		}

		_renderQueue() {
			if (!this.attached) {
				return;
			}
			const queue = this._indexRenderQueue;

			if (!Array.isArray(queue) || queue.length < 1) {
				// no tasks in queue
				return;
			}

			if (this.animating) {
				// will be re-run on transition end
				return;
			}

			if (this.hiddenRendering || this._isVisible) {

				this._renderRan = this._renderAbort = false;

				this._indexRenderQueue = queue
					.sort((a, b) => a === this.selected ? -1 : b === this.selected ? 1 : 0)
					.map(this._renderQueueProcess, this)
					.filter(idx => idx != null);

				if (this._renderAbort || this._indexRenderQueue.length === 0) {
					return;
				}
			}

			_asyncPeriod(this._renderQueue.bind(this));
		}

		_renderQueueProcess(idx) {
			const element = this._getElement(idx),
				item = this.items[idx];

			if (this.isIncompleteFn(item)) {
				element.item = false;
				// no data for item drop task from queue
				return;
			}

			if (this._renderRan) {
				// one render per run
				// maintain task in queue
				return idx;
			}
			if (element.__incomplete) {
				element.__incomplete._showHideChildren(true);
			}

			const isSelected = idx === this.selected,
				needsRender = element.item !== item;

			this._renderRan = needsRender;

			if (needsRender) {
				this._forwardItem(element, item, idx);
				if (isSelected) {
					return idx;
				}
			} else if (isSelected) {
				// resize is a expensive operation
				this._renderRan = this._notifyElementResize();
			}
		}

		_onCachePurge(e) {
			if (e == null || e.detail == null || !Array.isArray(e.detail.ids) || e.detail.ids.length === 0) {
				return this.clearCache();
			}
			e.detail.ids.forEach(id => delete this._cache[id]);
		}

		_getItemId(item) {
			return this.isIncompleteFn(item) ? item : this.get(this.idPath, item);
		}

		_updateHashForSelected(selected) {
			const hashParam = this.hashParam,
				idPath = this.idPath;

			if (!hashParam || !idPath || !this._routeHashParams || !this.items.length) {
				return;
			}

			const item = this.items[selected];
			if (item == null) {
				return;
			}
			const itemId = this._getItemId(item),
				path = ['_routeHashParams', hashParam],
				hashValue = this.get(path);

			if (itemId === hashValue) {
				return;
			}

			this.set(path, itemId);
		}

		_updateSelectedFromHash() {
			const hashParam = this.hashParam,
				idPath = this.idPath;

			if (!(hashParam && idPath && this._routeHashParams)) {
				return;
			}

			const path = ['_routeHashParams', hashParam],
				hashValue = this.get(path),
				selection = this.items.findIndex(i => this._getItemId(i) === hashValue);

			if (selection < 0 || selection === this.selected) {
				return;
			}

			this.selected = selection;
			return true;
		}
	}
	customElements.define(CosmozDataNav.is, CosmozDataNav);
}());
