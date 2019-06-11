import '@polymer/paper-icon-button/paper-icon-button';
import '@polymer/iron-flex-layout/iron-flex-layout';
import '@polymer/iron-flex-layout/iron-flex-layout-classes';

import { PolymerElement } from '@polymer/polymer/polymer-element';
import { html } from '@polymer/polymer/lib/utils/html-tag';

import { mixinBehaviors } from '@polymer/polymer/lib/legacy/class';
import { IronResizableBehavior } from '@polymer/iron-resizable-behavior/iron-resizable-behavior';

class CosmozDataNavResizableView extends mixinBehaviors([IronResizableBehavior], PolymerElement) {
	static get template() {
		return html`
			<style>
				.text {
					font-size: 300px;
					line-height: 360px;
					text-align: center;
				}
			</style>
			<div class="flex text">{{ item.id }}</div>
			<div>
				<paper-icon-button slot="actions" disabled\$="[[ prevDisabled ]]" icon="chevron-left" cosmoz-data-nav-select="-1"></paper-icon-button>
				<span>[[ index ]]</span>
				<paper-icon-button slot="actions" disabled\$="[[ nextDisabled ]]" icon="chevron-right" cosmoz-data-nav-select="+1"></paper-icon-button>
			</div>
		`;
	}

	static get is() {
		return 'cosmoz-data-nav-resizable-view';
	}
	static get properties() {
		return {
			item: {
				type: Object,
				notify: true
			},
			index: {
				type: Number
			},
			prevDisabled: {
				type: Boolean
			},
			nextDisabled: {
				type: Boolean
			}
		};
	}
	ready() {
		this.addEventListener('iron-resize', this._onIronResize);
		super.ready();
	}
	_onIronResize() {
		console.log('resize called on resizable view.');
	}
}
customElements.define(CosmozDataNavResizableView.is, CosmozDataNavResizableView);
