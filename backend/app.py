"""Fresco backend — application factory.

Wiring only: SQLite database, CORS for the Vite dev server, route blueprint.
All endpoint bodies are stubs until the logic phase.
"""

from flask import Flask
from flask_cors import CORS

from models import db
from routes import api


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///fresco.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)
    CORS(app, origins=["http://localhost:5173"])
    app.register_blueprint(api)

    with app.app_context():
        db.create_all()

    return app


if __name__ == "__main__":
    create_app().run(debug=True, port=5001)
