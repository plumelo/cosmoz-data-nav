// @license Copyright (C) 2015 Neovici AB - Apache 2 License
/*global Cosmoz, Polymer */

(function () {
	'use strict';
	const IS_V2 = Polymer.flush != null,
		_async = window.requestIdleCallback || window.requestAnimationFrame || Polymer.Base.async,
		_hasDeadline = 'IdleDeadline' in window,
		_asyncPeriod = (cb, minimum = 16, timeout = 1500) =>
			_async(deadline => {
				if (_hasDeadline && deadline != null) {
					const _isDeadline = deadline instanceof window.IdleDeadline;
					if (_isDeadline && !deadline.didTimeout && deadline.timeRemaining() < minimum) {
						return _asyncPeriod(cb, minimum);
					}
				}
				cb();
			}, timeout == null ? undefined : { timeout }),
		_doAsyncSteps = (steps, minDeadline = 16, timeout) => {
			const callStep = () => {
				if (!Array.isArray(steps) || steps.length < 1) {
					return;
				}
				const step = steps.shift();
				step();
				_asyncPeriod(callStep, minDeadline, timeout);
			};
			return _asyncPeriod(callStep, minDeadline, timeout);
		};

	Polymer({
		is: 'cosmoz-data-nav',
		properties: {
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
			 * The currently selected item, or `null` if no item is selected.
			 */
			selectedItem: {
				type: Object,
				notify: true,
				readOnly: true
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
			this._elements = [];
		},

		/**
		 * Polymer `attached` livecycle function.
		 *
		 * @return {void}
		 */
		attached() {
			this._templatesObserver = Polymer.dom(this.$.templatesSlot).observeNodes(this._onTemplatesChange.bind(this));
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

			const steps = Array(this.elementsBuffer).fill(this._createElement.bind(this)),
				first = steps.shift();

			_asyncPeriod(() => {
				first.call();
				_doAsyncSteps(steps);
			}, 16, 200);
		},

		_templatize(elementTemplate, incompleteTemplate) {
			this._elementTemplate = elementTemplate;
			this._incompleteTemplate = incompleteTemplate;

			let baseProps = {
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
			const items = this.items,
				index = inst.index;
			if (prop !== this.as || value === items[index] || this._allElementInstances.indexOf(inst) < 0) {
				return;
			}
			this.removeFromCache(items[index]);
			this.set(['items', index], value);
		},

		_createElement() {
			if (this._elements.length >= this.elementsBuffer) {
				return;
			}

			const elements = this._elements,
				index = elements.length,
				element = document.createElement('div'),
				incomplete = new this._incompleteCtor({});

			element.setAttribute('slot', 'items');
			element.classList.add('animatable', 'incomplete');
			element.__incomplete = incomplete;
			elements.push(element);

			Polymer.dom(element).appendChild(incomplete.root);
			Polymer.dom(this).appendChild(element);

			if (this.selected != null && index === this.selected) {
				this.animating = false;
				this._updateSelected();
				return;
			}
			this._synchronize();
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
			this._isPreloading = false;
			this._preload();

			if (this.animating) {
				return;
			}
			if (index === this.selected) {
				return this._updateSelected();
			}
			this._synchronize();
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

			this._isPreloading = false;

			//Update readOnly queueLength
			this._setQueueLength(length >> 0);

			if (length) {
				items.forEach((item, index) => {
					if (this.isIncompleteFn(item) && this._cache[item]) {
						this.set(['items', index], this._cache[item]);
					}
				});
			}

			this.selected = this._preloadIdx = 0;
			this._synchronize();
			this._preload();
		},

		/**
		 * Observes changed to `selected` property and
		 * updates related properties and the `selected` page.
		 *
		 * @param  {Number} selected The selected property
		 * @return {void}
		 */
		_updateSelected(selected = this.selected) {
			this._setSelectedNext((this.selected || 0) + 1);

			const element = this._elements[selected % this.elementsBuffer];

			if (!element) {
				return;
			}

			let classes = element.classList,
				prev = this._selectedElement;

			classes.toggle('in', this.animating);
			classes.add('selected');

			this._selectedElement = element;

			if (!this.animating) {
				this._synchronize();
				this._notifyElementResize(this._selectedElement);
				return;
			}

			requestAnimationFrame(() => {
				if (prev && prev !== this._selectedElement && element.offsetWidth) {
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

			if (!this.animating || !elements.length || elements.indexOf(e.target) < 0) {
				return;
			}

			this.animating = false;
			this._elements.forEach(el => {
				const classes = el.classList;
				classes.remove('in', 'out');
			});
			this._synchronize();
			this._notifyElementResize(this._selectedElement);
			this._preload();
		},

		/**
		 * Preloads items that are not loaded depending on the currently
		 * selected item and the `preload` property.
		 *
		 * @fires need-data
		 * @return {void}
		 */
		_preload() {
			if (!Array.isArray(this.items) || this.items.length === 0 || this._isPreloading) {
				return;
			}

			const index = this._preloadIdx,
				item = this.items[index];

			if (this.isIncompleteFn(item)) {
				this._isPreloading = true;
				this.fire('need-data', { id: item, render: true });
				return;
			}

			if (index >= Math.min(this.selected + this.preload, this.items.length - 1)) {
				return;
			}

			this._preloadIdx++;
			this._preload();
		},

		_getBaseProps(index) {
			return {
				prevDisabled: index < 1,
				nextDisabled: index + 1  >= this.items.length,
				[this.indexAs]: Math.max(index, 0)
			};
		},

		_toggleInstance(element, index, incomplete) {
			if (element.__instanceActive === !incomplete) {
				return;
			}

			const baseProps = this._getBaseProps(index);

			element.__instanceActive = !incomplete;

			if (element.__incomplete) {
				element.__incomplete._showHideChildren(!incomplete);
				Object.assign(element.__incomplete, baseProps);
			}

			if (element.__instance) {
				element.__instance._showHideChildren(incomplete);
				Object.assign(element.__instance, baseProps);
			}
		},

		/**
		 * Forwards an item from `items` property to a template instance.
		 *
		 * @param  {HTMLElement} element The element
		 * @param  {Object}      item     The item to forward
		 * @return {void}
		 */
		_forwardItem(element, item) {
			if (element.item === item) {
				// already rendered
				return;
			}

			this._removeInstance(element.__instance);

			const items = this.items,
				index = items.indexOf(item),
				instance = new this._elementCtor({});

			Object.assign(instance, { [this.as]: item }, this._getBaseProps(index));

			element.__instance = instance;
			element.item = item;

			Polymer.dom(element).appendChild(instance.root);
			instance._showHideChildren(false);
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

		/**
		 * Check if a element is a descendant of the currently selected element.
		 *
		 * @param  {HTMLElement} element A descendant resizable element
		 * @return {Boolean} True if the element should be notified
		 */
		resizerShouldBeNotified(element) {
			return element.closest('.animatable')  === this._selectedElement;
		},


		/**
		 * Handles resize notifications from descendants.
		 *
		 * @param  {Event} event The resize event
		 * @return {void}
		 */
		_onDescendantIronResize(event) {
			if (this._notifyingDescendant || this.animating || !this._isVisible || !this.resizerShouldBeNotified(event.target)) {
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
		 * @return {void}
		 */
		_notifyElementResize(element) {
			if (!this.isAttached) {
				return;
			}

			const instance = element.__instance;

			if (instance == null) {
				return;
			}

			const children = IS_V2 ? instance.children : instance._children,
				resizable = this._interestedResizables.find(resizable => {
					return Array.prototype.some.call(children, child => {
						let parent = resizable;
						while (parent && parent !== this) {
							if (parent === child) {
								return true;
							}
							parent = parent.parentNode;
						}
						return false;
					});
				});

			if (!resizable) {
				return;
			}

			this._notifyDescendant(resizable);
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

		/**
		* Syncronizes the `items` data with the created template instances
		* depending on the currently selected item.
		*
		* @return {type}  description
		*/
		_synchronize() {
			if (this._elements == null || this.elementsBuffer == null) {
				return;
			}
			const buffer = this.elementsBuffer,
				offset = buffer / 2 >> 0,
				max = Math.max,
				min = Math.min,
				length = this.items.length,
				end = max(min(this.selected + offset, length ? length - 1 : 0), buffer - 1),
				index = min(max(this.selected - offset, 0), length ? length - buffer : 0),
				numSteps = end - index + 1;

			this._indexRenderQueue = Array(numSteps).fill().map((u, idx) => index + idx);
			this._renderQueue();
		},

		_renderQueue() {

			const queue = this._indexRenderQueue;

			if (!Array.isArray(queue) || queue.length < 1) {
				// no tasks in queue
				return;
			}

			if (!Array.isArray(this._elements) || this._elements.length < 1) {
				// no elements to render to
				// will be re-run when elements are created
				return;
			}

			if (this.animating) {
				// will be re-run on transition end
				return;
			}

			let renderRun = false,
				reRun = true;

			this._indexRenderQueue = queue
				.sort((a, b) => a === this.selected ? -1 : b === this.selected ? 1 : 0)
				.map(idx => {

					const elementIndex = idx % this.elementsBuffer,
						element = this._elements[elementIndex],
						item = this.items[idx];

					if (!element) {
						// don't re-run _renderQueue()
						// will be re-run when elements are created
						reRun = false;
						// maintain task in queue
						return idx;
					}

					const incomplete = this.isIncompleteFn(item);
					this._toggleInstance(element, idx, incomplete);

					if (incomplete) {
						// no data for item, instance has been toggled
						// drop task from queue
						return;
					}

					if (element.item === item) {
						// already rendered
						// drop task from queue
						return;
					}

					if (renderRun) {
						// one render per run
						// maintain task in queue
						return idx;
					}

					this._forwardItem(element, item);
					renderRun = true;
				})
				.filter(idx => idx != null);

			if (!reRun) {
				return;
			}

			_asyncPeriod(this._renderQueue.bind(this));
		}
	});
}());
