import os
import json
from datetime import datetime
from flask import Flask, render_template, session
from flask_socketio import SocketIO, emit
import mysql.connector

app = Flask(__name__)
# Uses environment variable for secret key, falls back to a default if not found
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'heaven_secret_token_2026')

# 50 MB payload handling limit configuration matching your design
socketio = SocketIO(app, max_http_buffer_size=50000000, cors_allowed_origins="*")

# Read configurations safely
with open("config.json", "r") as f:
    config = json.load(f)

CHAT_PASSCODE = config.get("chatPasscode")
ALLOWED_USERS = ["Sunshine", "Angel"]
online_users = 0

# Database Helper Function updated for Render Environment Variables
def get_db_connection():
    return mysql.connector.connect(
        host=os.environ.get('DB_HOST', 'localhost'),
        user=os.environ.get('DB_USER', 'chat_user'),
        password=os.environ.get('DB_PASSWORD', 'Shiva@280501#'),
        database=os.environ.get('DB_NAME', 'chat_db'),
        port=int(os.environ.get('DB_PORT', 3306))
    )

def init_db():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sender_name VARCHAR(255),
                text LONGTEXT,
                created_at VARCHAR(255),
                parent_id INT DEFAULT NULL,
                reactions LONGTEXT
            )
        """)
        conn.commit()
        cursor.close()
        conn.close()
        print("✅ Database connection and table verified.")
    except Exception as e:
        print(f"❌ Database initialization warning: {e}")

# Initialize Database Connection
init_db()

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    global online_users
    online_users += 1
    session['authenticated'] = False
    session['username'] = ""
    emit('online-users', online_users, broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    global online_users
    online_users -= 1
    emit('online-users', online_users, broadcast=True)

@socketio.on('check-passcode')
def handle_check_passcode(data):
    if not data:
        emit('access-denied')
        return
    
    formatted_name = data.get('name', '').strip()
    provided_code = data.get('code')

    if provided_code == CHAT_PASSCODE and formatted_name in ALLOWED_USERS:
        session['authenticated'] = True
        session['username'] = formatted_name
        emit('access-granted', {'username': session['username']})

        try:
            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM messages ORDER BY id ASC")
            rows = cursor.fetchall()
            
            cleaned_messages = []
            for row in rows:
                msg_payload = {
                    'id': int(row['id']),
                    'sender_name': str(row['sender_name'] or ''),
                    'text': str(row['text'] or ''),
                    'created_at': str(row['created_at'] or ''),
                    'parent_id': int(row['parent_id']) if row.get('parent_id') is not None else None,
                    'reactions': {}
                }
                
                rx_data = row.get('reactions')
                if rx_data:
                    if isinstance(rx_data, str):
                        stripped = rx_data.strip()
                        if stripped and stripped != "{}":
                            try:
                                msg_payload['reactions'] = json.loads(stripped)
                            except Exception:
                                msg_payload['reactions'] = {}
                cleaned_messages.append(msg_payload)
            
            emit('load-messages', cleaned_messages)
            cursor.close()
            conn.close()
        except Exception as err:
            print(f"❌ History Read Error: {err}")
    else:
        emit('access-denied')

@socketio.on('typing')
def handle_typing():
    if session.get('authenticated'):
        emit('typing', session.get('username'), broadcast=True, include_self=False)

@socketio.on('chat-message')
def handle_chat_message(data):
    if not session.get('authenticated') or not data:
        return
        
    message_text = data if isinstance(data, str) else data.get('text', '')
    parent_id = None if isinstance(data, str) else data.get('parentId')
    now = datetime.now().strftime("%d/%m/%Y, %H:%M:%S")

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        stmt = "INSERT INTO messages (sender_name, text, created_at, parent_id, reactions) VALUES (%s, %s, %s, %s, %s)"
        cursor.execute(stmt, (session.get('username'), message_text, now, parent_id, '{}'))
        conn.commit()
        last_id = cursor.lastrowid
        cursor.close()
        conn.close()

        msg_obj = {
            'id': int(last_id),
            'sender_name': str(session.get('username')),
            'text': str(message_text),
            'created_at': str(now),
            'parent_id': int(parent_id) if parent_id is not None else None,
            'reactions': {}
        }

        emit('chat-message', msg_obj, broadcast=True)
    except Exception as err:
        print(f"❌ Message Insertion Error: {err}")

@socketio.on('toggle-reaction')
def handle_toggle_reaction(data):
    if not session.get('authenticated') or not data:
        return
    
    message_id = data.get('messageId')
    emoji = data.get('emoji')
    current_username = session.get('username')

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT reactions FROM messages WHERE id = %s", (message_id,))
        row = cursor.fetchone()
        
        if not row:
            cursor.close()
            conn.close()
            return

        reactions_str = row['reactions'] or '{}'
        try:
            reactions = json.loads(reactions_str)
        except Exception:
            reactions = {}

        if emoji not in reactions:
            reactions[emoji] = []

        user_list = reactions[emoji]
        if current_username in user_list:
            user_list.remove(current_username)
            if not user_list:
                del reactions[emoji]
        else:
            for key in list(reactions.keys()):
                if current_username in reactions[key]:
                    reactions[key].remove(current_username)
                    if not reactions[key]:
                        del reactions[key]
            if emoji not in reactions:
                reactions[emoji] = []
            reactions[emoji].append(current_username)

        updated_str = json.dumps(reactions)
        cursor.execute("UPDATE messages SET reactions = %s WHERE id = %s", (updated_str, message_id))
        conn.commit()
        cursor.close()
        conn.close()

        emit('reaction-updated', {'messageId': int(message_id), 'reactions': reactions}, broadcast=True)
    except Exception as err:
        print(f"❌ Reaction Database Error: {err}")

@socketio.on('edit-message')
def handle_edit_message(data):
    if not session.get('authenticated'):
        return
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT sender_name FROM messages WHERE id = %s", (data.get('id'),))
        row = cursor.fetchone()
        
        if row and row['sender_name'] == session.get('username'):
            cursor.execute("UPDATE messages SET text = %s WHERE id = %s", (data.get('newText'), data.get('id')))
            conn.commit()
            emit('message-edited', {'id': int(data.get('id')), 'text': str(data.get('newText'))}, broadcast=True)
            
        cursor.close()
        conn.close()
    except Exception as err:
        print(f"❌ Message Edit Error: {err}")

@socketio.on('delete-messages')
def handle_delete_messages(ids):
    if not session.get('authenticated') or not isinstance(ids, list) or len(ids) == 0:
        return
    
    clean_ids = [int(x) for x in ids if str(x).isdigit()]
    if not clean_ids:
        return

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        format_strings = ','.join(['%s'] * len(clean_ids))
        query = f"SELECT id FROM messages WHERE id IN ({format_strings}) AND sender_name = %s"
        
        cursor.execute(query, clean_ids + [session.get('username')])
        rows = cursor.fetchall()
        verified_ids = [int(row['id']) for row in rows]

        if verified_ids:
            del_format_strings = ','.join(['%s'] * len(verified_ids))
            cursor.execute(f"DELETE FROM messages WHERE id IN ({del_format_strings})", verified_ids)
            conn.commit()
            emit('messages-deleted', verified_ids, broadcast=True)

        cursor.close()
        conn.close()
    except Exception as err:
        print(f"❌ Message Delete Error: {err}")

if __name__ == '__main__':
    # Dynamic port configuration for Render production deployment
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)