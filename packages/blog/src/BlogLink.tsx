import {
	type AnchorHTMLAttributes,
	createContext,
	type ReactElement,
	useContext,
} from "react";

/** The host router's navigate function, or null for plain page loads. */
export const NavigateContext = createContext<((href: string) => void) | null>(
	null,
);

export interface ClickLike {
	defaultPrevented: boolean;
	button: number;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

/** Only a plain left click is the router's; new-tab, new-window and download gestures stay the browser's. */
export function isPlainLeftClick(event: ClickLike): boolean {
	return (
		!event.defaultPrevented &&
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	);
}

/** A real link the host router can take over on an unmodified left click. */
export function BlogLink({
	href,
	children,
	...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): ReactElement {
	const navigate = useContext(NavigateContext);
	return (
		<a
			{...rest}
			href={href}
			onClick={(event) => {
				if (!navigate || !isPlainLeftClick(event)) return;
				event.preventDefault();
				navigate(href);
			}}
		>
			{children}
		</a>
	);
}
