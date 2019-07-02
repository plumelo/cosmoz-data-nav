import '@polymer/paper-icon-button/paper-icon-button';
import '@polymer/iron-flex-layout/iron-flex-layout';
import '@polymer/iron-flex-layout/iron-flex-layout-classes';

import { PolymerElement } from '@polymer/polymer/polymer-element';
import { html } from '@polymer/polymer/lib/utils/html-tag';

class CosmozDataNavTestView extends PolymerElement {
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
				<paper-icon-button slot="actions" disabled$="[[ prevDisabled ]]" icon="chevron-left" cosmoz-data-nav-select="-1"></paper-icon-button>
				<span>[[ index ]]</span>
				<paper-icon-button slot="actions" disabled$="[[ nextDisabled ]]" icon="chevron-right" cosmoz-data-nav-select="+1"></paper-icon-button>
			</div>
		`;
	}

	static get is() {
		return 'cosmoz-data-nav-test-view';
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
}
customElements.define(CosmozDataNavTestView.is, CosmozDataNavTestView);
