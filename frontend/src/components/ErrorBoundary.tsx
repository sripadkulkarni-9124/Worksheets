import { Component, ReactNode } from 'react'

interface Props { children: ReactNode; name?: string }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.log('[EB]', this.props.name || '', error.message, '\n', error.stack, '\n', info.componentStack)
    ;(window as unknown as { __boundaryError: unknown }).__boundaryError = { msg: error.message, stack: error.stack, cs: info.componentStack }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: '#fca5a5', background: '#1f1720', border: '1px solid #7f1d1d', borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap' }}>
          <strong>{this.props.name || 'Error'}:</strong> {this.state.error.message}
        </div>
      )
    }
    return this.props.children
  }
}
