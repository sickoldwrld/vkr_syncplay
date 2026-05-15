FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
# Прогрев зависимостей: dependency:resolve мягче чем go-offline и не падает
# на плагин-репортинг старых артефактов (jaudiotagger ссылается на parent
# с unresolved property placeholders).
RUN mvn -B -DincludeScope=runtime dependency:resolve || true
COPY src ./src
RUN mvn clean package -DskipTests -B

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
