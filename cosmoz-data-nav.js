// @license Copyright (C) 2015 Neovici AB - Apache 2 License
/*global Cosmoz, Polymer */

(function () {
	'use strict';
	const IS_V2 = Polymer.flush != null,
		_async = window.requestIdleCallback || window.requestAnimationFrame || Polymer.Base.async,
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
			return _asyncPeriod(callStep, timeout);
		};

	Polymer({
		is: 'cosmoz-data-nav',
		properties: {
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

			_hasItems: {
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
				computed: '_getElement(selected, _elements)'
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
				computed: '_getItem(selected, items)'
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
				type: Object,
				notify: true
			},

			/**
			 *
			 */
			idPath: {
				type: String,
				value: 'id'
			}
		},

		behaviors: [
			Polymer.IronResizableBehavior
		],

		listeners: {
			tap: '_onTap',
			transitionend: '_onTransitionEnd'
		},

		/**
		 * Polymer `created` livecycle function.
		 *
		 * @return {void}
		 */
		created() {
			this._cache = {};
			this._preloadIdx = 0;
		},

		/**
		 * Polymer `attached` livecycle function.
		 *
		 * @return {void}
		 */
		attached() {
			this._templatesObserver = Polymer.dom(this.$.templatesSlot)
				.observeNodes(this._onTemplatesChange.bind(this));
			this.listen(window, 'cosmoz-cache-purge', '_onCachePurge');
		},

		/**
		 * Polymer `detached` livecycle function.
		 *
		 * @return {void}
		 */
		detached() {
			if (this._templatesObserver) {
				Polymer.dom(this).unobserveNodes(this._templatesObserver);
				this._templatesObserver = null;
			}
			this._cache = {};
			this._indexRenderQueue = [];
			this.unlisten(window, 'cosmoz-cache-purge', '_onCachePurge');
		},

		_onTemplatesChange(change) {
			if (this._elementTemplate) {
				return;
			}
			const templates = change.addedNodes.filter(n => n.nodeType === Node.ELEMENT_NODE && n.tagName === 'TEMPLATE'),
				elementTemplate = templates.find(n => n.matches(':not([incomplete])')),
				incompleteTemplate = templates.find(n => n.matches('[incomplete]')) || this.$.incompleteTemplate;

			if (!elementTemplate) {
				console.warn('cosmoz-data-nav requires a template');
				return;
			}
			this._templatize(elementTemplate, incompleteTemplate);

			const elements = this._elements,
				length = elements.length;

			elements.splice(-1, 0, ...Array(this.elementsBuffer - length)
				.fill().map(this._createElement, this));

			_doAsyncSteps(elements.map(el => {
				Polymer.dom(this).appendChild(el);
				return this._createIncomplete.bind(this, el);
			}));
		},

		_templatize(elementTemplate, incompleteTemplate) {
			this._elementTemplate = elementTemplate;
			this._incompleteTemplate = incompleteTemplate;

			const baseProps = {
				prevDisabled: true,
				nextDisabled: true,
				[this.indexAs]: true
			};
			this._elementCtor = Cosmoz.Templatize.templatize(this._elementTemplate, this, {
				instanceProps: Object.assign({[this.as]: true}, baseProps),
				parentModel: true,
				forwardParentProp: this._forwardHostProp,
				forwardParentPath: this._forwardParentPath,
				forwardHostProp: this._forwardHostProp,
				forwardInstanceProp: this._notifyInstanceProp,
				notifyInstanceProp: this._notifyInstanceProp
			});
			this._incompleteCtor = Cosmoz.Templatize.templatize(this._incompleteTemplate, this, {
				instanceProps: baseProps,
				parentModel: true,
				forwardParentProp: this._forwardHostProp,
				forwardParentPath: this._forwardParentPath,
				forwardHostProp: this._forwardHostProp,
			});
		},

		get _allInstances() {
			return this._elements
				.reduce((p, n) => p.concat([n.__instance, n.__incomplete]), [])
				.filter(i => i != null);
		},

		get _allElementInstances() {
			return this._elements
				.map(e => e.__instance)
				.filter(i => i != null);
		},

		_forwardParentPath(path, value) {
			const instances = this._allInstances;
			if (!instances || !instances.length) {
				return;
			}
			instances.forEach(inst => inst.notifyPath(path, value, true));
		},

		_forwardHostProp(prop, value) {
			const instances = this._allInstances;
			if (!instances || !instances.length) {
				return;
			}
			instances.forEach(inst => IS_V2 ? inst.forwardHostProp(prop, value) : inst[prop] = value);
		},

		_notifyInstanceProp(inst, prop, value) {
			const index = inst.index,
				item = this.items[index];
			if (prop !== this.as || value === item || this._allElementInstances.indexOf(inst) < 0) {
				return;
			}
			this.removeFromCache(item);
			this.set(['items', index], value);
		},

		_createElement() {
			const element = document.createElement('div');
			element.setAttribute('slot', 'items');
			element.classList.add('animatable');
			return element;
		},

		_createIncomplete(element) {
			if (element.__incomplete) {
				return;
			}
			const incomplete = new this._incompleteCtor({});
			element.__incomplete = incomplete;
			Polymer.dom(element).appendChild(incomplete.root);
		},

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
		},

		/**
		 * Replace an id in the `items` element list with the full data of the item.
		 *
		 * @param  {type} id     The id currently stored in the `items` array
		 * @param  {Object} item The full data of object
		 * @return {void}
		 */
		setItemById(id, item) {
			const index = this.items.indexOf(id);

			if (index < 0) {
				console.warn('trying to replace an item that is not in the list', id, item);
				return;
			}

			this.set(['items', index], this._cache[id] = item);
			this._preload();

			if (this.animating || this.selected == null) {
				return;
			}

			this._updateSelected();
		},

		clearCache() {
			this._cache = {};
		},

		removeFromCache(item) {
			if (item == null) {
				return;
			}
			const cache = this._cache,
				key = Object.keys(cache).find(k => cache[k] === item);
			if (key != null) {
				delete cache[key];
			}
		},

		/**
		 * Observes full changes to `items` properties
		 * and replaces cached items with full data if available.
		 *
		 * @param  {type} items description
		 * @return {type}       description
		 */
		_itemsChanged(items) {
			const length = items && items.length;

			//Update readOnly queueLength
			this._setQueueLength(length >> 0);
			this._set_hasItems(!!length);

			if (length) {
				items.forEach((item, index) => {
					if (this.isIncompleteFn(item) && this._cache[item]) {
						this.set(['items', index], this._cache[item]);
					}
				});
			}

			if (this._updateSelectedFromHash()) {
				return;
			}

			if (this.selected === 0) {
				return this._updateSelected();
			}

			this.selected = 0;

		},

		/**
		 * Observes changed to `selected` property and
		 * updates related properties and the `selected` page.
		 *
		 * @param  {Number} selected The selected property
		 * @param  {Number} previous The previous value of selected property
		 * @return {void}
		 */
		_updateSelected(selected = this.selected, previous) {
			this._setSelectedNext((selected || 0) + 1);
			this._setSelectedItem(this.items[selected]);
			this._preload(selected);

			const element = this._getElement(selected);

			this._updateHashForSelected(selected);

			const classes = element.classList,
				animating = this.animating && previous != null && previous !== selected,
				prev = animating && this._getElement(previous);

			if (!animating) {
				this._elements.forEach(el => el.classList.remove('selected'));
			}

			classes.toggle('in', !!this.animating);
			classes.add('selected');

			if (!animating) {
				if (this.isAttached) {
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
		},

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
		},

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
				this.fire('need-data', { id: item, render: true });
				return;
			}

			if (index >= Math.min(this.selected + this.preload, items.length - 1)) {
				return;
			}

			this._preloadIdx = index + 1;
			this._preload();
		},

		_getBaseProps(index) {
			return {
				prevDisabled: index < 1,
				nextDisabled: index + 1  >= this.items.length,
				[this.indexAs]: Math.max(index, 0)
			};
		},

		_getElement(index) {
			return this._elements[index % (this.elementsBuffer || this._elements.length) ];
		},

		_getInstance(selectedElement) {
			if (selectedElement == null || selectedElement.children.length < 2) {
				return;
			}
			// index 0 is incomplete element
			return selectedElement.children[1];
		},

		_getItem(index, items = this.items) {
			return items[index];
		},

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
		},

		_removeInstance(instance) {
			if (!instance) {
				return;
			}
			const children = IS_V2 ? instance.children : instance._children;

			for (let i = 0; i < children.length; i++) {
				const child = children[i],
					parent = child.parentNode;
				Polymer.dom(parent).removeChild(child);
			}
		},

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

		},

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
			const path = Polymer.dom(event).path,
				attr = this.selectAttribute,
				selectEl = path.find(e => e && e.hasAttribute && e.hasAttribute(attr));

			if (!selectEl) {
				return;
			}
			let inBetween = path.slice(path.indexOf(selectEl)),
				ancestorNav = inBetween.find(e => e.is && e.is === this.is),
				select;

			if (ancestorNav !== this) {
				return;
			}

			select = parseInt(selectEl.getAttribute(attr), 10);

			if (isNaN(select)) {
				return;
			}
			this.debounce('select', () => {
				this.animating = true;
				this.select(this.selected + select);
			}, 15);
		},

		/**
		* True if the current element is visible.
		*/
		get _isVisible() {
			return Boolean(this.offsetWidth || this.offsetHeight);
		},

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
		},

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

			return Array.from(IS_V2 ? instance.children : instance._children)
				.filter(c => c.nodeType === Node.ELEMENT_NODE)
				.some(child => this._isDescendantOf(descendant, child));
		},

		/**
		 * Check if a element is a descendant of the currently selected element.
		 *
		 * @param  {HTMLElement} resizable A descendant resizable element
		 * @return {Boolean} True if the element should be notified
		 */
		resizerShouldNotify(resizable) {
			return this._isDescendantOfElementInstance(resizable, this.selectedElement);
		},

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
		},

		notifyResize() {
			if (!this.isAttached || this.animating || !this._isVisible) {
				return;
			}
			Polymer.IronResizableBehavior.notifyResize.call(this);
		},

		/**
		 * Notifies a descendant resizable of the element.
		 *
		 * @param  {HTMLElement} element The element to search within for a resizable
		 * @return {Boolean} True if descendant has been notified.
		 */
		_notifyElementResize(element = this.selectedElement) {
			if (!this.isAttached || !element) {
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
		},

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
		},

		_forwardItem(element, item, idx) {
			this._removeInstance(element.__instance);
			const instance = new this._elementCtor({});
			Object.assign(instance, { [this.as]: item }, this._getBaseProps(idx));

			element.__instance = instance;
			element.item = item;
			element._reset = false;
			Polymer.dom(element).appendChild(instance.root);
		},

		_renderQueue() {
			const queue = this._indexRenderQueue;

			if (!Array.isArray(queue) || queue.length < 1) {
				// no tasks in queue
				return;
			}

			if (this.animating) {
				// will be re-run on transition end
				return;
			}

			this._renderRan = this._renderAbort = false;

			this._indexRenderQueue = queue
				.sort((a, b) => a === this.selected ? -1 : b === this.selected ? 1 : 0)
				.map(this._renderQueueProcess, this)
				.filter(idx => idx != null);

			if (this._renderAbort || this._indexRenderQueue.length === 0) {
				return;
			}

			_asyncPeriod(this._renderQueue.bind(this));
		},

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

			element.__incomplete._showHideChildren(true);

			const isSelected = idx === this.selected,
				needsRender  = element.item !== item;

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
		},

		_onCachePurge(e, detail) {
			const ids = detail.ids;
			if (!Array.isArray(ids) || ids.length === 0) {
				return this.clearCache();
			}
			ids.forEach(id => delete this._cache[id]);
		},

		_getItemId(item) {
			return this.isIncomplete(item) ? item  : this.get(this.idPath, item);
		},

		_updateHashForSelected(selected) {
			const hashParam = this.hashParam,
				idPath = this.idPath;

			if (!(hashParam && idPath && this._routeHashParams && this.items.length)) {
				return;
			}

			const item = this.items[selected];
			if (item == null) {
				return;
			}
			const	itemId = this._getItemId(item),
				path = ['_routeHashParams', hashParam],
				hashValue = this.get(path);

			if (itemId === hashValue) {
				return;
			}

			this.set(path, itemId);
		},

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

	});
}());
